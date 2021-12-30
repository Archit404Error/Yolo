import { MongoClient, ObjectId } from 'mongodb';
import { Expo } from 'expo-server-sdk';
import bp from 'body-parser';
import express from 'express';
import nodeGeocoder from 'node-geocoder';

import socketHandler from './socketHandler.js';

const app = express();
const locationFinder = nodeGeocoder({
    provider : 'openstreetmap',
})

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
var db, chatCollection, eventCollection, userCollection, expoServer;

/** 
 * Returns JSON data of event with a given id
 */
app.get('/event/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send(error);
    eventCollection.findOne({"_id" : new ObjectId(req.params.id)}, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/** 
 * Returns JSON data of user with a given id
 */
app.get('/user/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    userCollection.findOne({"_id" : new ObjectId(req.params.id)}, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/**
 * Loads all chats for a user based on user's id
 */
app.get('/userChats/:id', async (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    const found = chatCollection.find({"members" : new ObjectId(req.params.id)});
    if ((await found.count()) == 0) return res.send([])
    res.send(await found.toArray())
})

/** 
 * Returns JSON data of chat with a given id
 */
app.get('/chat/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    chatCollection.findOne({"_id" : new ObjectId(req.params.id)}, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/**
 * Returns event details based on a chat's corresponding event
 */
app.get('/chatDetails/:id', async (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    const joined = await chatCollection.aggregate([
        {
            $lookup: {
                from: "Events",
                localField: "event",
                foreignField: "_id",
                as: "eventDetails"
            }
        },
        {
            $unwind: "$eventDetails"
        },
        {
            $match: { "_id" : new ObjectId(req.params.id) }
        }
    ]).next();
    res.send(joined)
})

/**
 * Returns user details of all participants in a chat
 */
app.get('/chatUsers/:id', async (req, res) => {
    if (!req.params.id) return res.status(500).send("Invalid chat id");
    const result = await chatCollection.aggregate([
        {
            $lookup: {
                from: "Users",
                localField: "members",
                foreignField: "_id",
                as: "memberDetails"
            }
        },
        {
            $project: {
                "memberDetails._id": 1,
                "memberDetails.name": 1,
                "memberDetails.profilePic": 1
            }
        },
        { $match: { "_id" : new ObjectId(req.params.id) } }
    ]).next();
    res.send(result);
})

/** 
 * Authenticates users by returning JSON data if auth suceeds, else returns empty response
 */
app.post('/auth', bp.json(), (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (!username || !password) return res.status(500).send("Authentication Error")
    userCollection.findOne({"username" : username, "password" : password}, (err, result) => {
        if (err) return res.status(500).send(err);
        if (result == null) return res.send({});
        res.send(result);
    });
})

/**
 * Inserts a new user into the DB
 */
app.post('/register', bp.json(), (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    const name = req.body.name;
    const userData = {
        "username" : username,
        "password" : password,
        "name" : name,
        "rejectedEvents" : [],
        "acceptedEvents" : [],
        "pendingEvents" : [],
        "friends" : [],
        "friendReqs" : [],
        "profilePic" : "https://firebasestorage.googleapis.com/v0/b/eventapp-73ba7.appspot.com/o/Profiles%2Fdefault_user.png?alt=media&token=c4f609d3-a714-4d70-8383-ac59368ac640",
        "tokens" : []
    }
    userCollection.insertOne(userData)
    .then(doc => {
        userData["_id"] = doc.insertedId
        res.send(userData);
    })
})

/**
 * Assigns a push token to a user
 */
app.post('/registerPushToken', bp.json(), (req, res) => {
    const userId = req.body.user;
    const token = req.body.token;
    userCollection.updateOne(
        {"_id" : new ObjectId(userId)},
        {$addToSet : {"tokens" : token}}
    )
    res.send("success")
})

/**
 * Creates a new Event (and its corresponding chat)
 */
app.post('/create', bp.json(), (req, res) => {
    const image = req.body.image;
    const title = req.body.title;
    const desc = req.body.description;
    const loc = req.body.location;
    const tags = req.body.tags;
    const other = req.body.other;
    let longitude = 0;
    let latitude = 0;

    locationFinder.geocode(loc)
    .then(res => res[0])
    .then(actualRes => {
        longitude = actualRes.longitude;
        latitude = actualRes.latitude;
    })
    .then(() => {
        eventCollection.insertOne({
            "image" : image,
            "title" : title,
            "description" : desc,
            "location" : loc,
            "tags" : tags,
            "latitude" : latitude,
            "longitude" : longitude,
            "other" : other,
            "attendees": [],
        })
        .then(inserted => {
            chatCollection.insertOne({
                "event" : inserted.insertedId,
                "messages" : [],
                "members" : []
            })
        })
    })

    res.send("OK")
})

/**
 * Records a message sent by a user in a chat
 */
app.post('/sendMessage', bp.json(), (req, res) => {
    const senderId = req.body.sender;
    const message = req.body.message;
    const chatId = req.body.chat;
    if (!senderId || !message || !chatId) {
        return res.status(500).send("Incorrectly formatted request");
    }
    chatCollection.findOneAndUpdate(
        {"_id" : new ObjectId(chatId)},
        {$push : { "messages" : [senderId, message] } },
        {returnNewDocument: true}
    )
        .then(updatedDoc => {
            let notifs = [];
            for (const memberId of updatedDoc.value.members) {
                if (memberId != senderId) {
                    userCollection.findOne({"_id" : memberId})
                        .then(userDoc => {
                            for (const token of userDoc.tokens) {
                                notifs.push({
                                    to: token,
                                    sound: 'default',
                                    body: message,
                                    data: { withSome: 'data' },
                                })
                            }
                        })
                }
            }
            let chunks = expoServer.chunkPushNotifications(notifs);
            let tickets = [];
            (async () => {
                for (let chunk of chunks) {
                    try {
                        let ticketChunk = expoServer.sendPushNotificationsAsync(chunk);
                        tickets.push(...ticketChunk);
                    } catch (err) {
                        res.status(500).send("Error while sending notif chunk");
                    }
                }
            })();
        })
    res.send("OK")
})

/**
 * Sends a friend request
 * Requires: sender (String) and receiver (String) are sent in the request
 */
app.post('/friendReq', bp.json(), (req, res) => {
    const senderId = req.body.sender;
    const receiverId = req.body.receiver;
    const wantToFriend = req.body.wantToFriend;
    if (wantToFriend) {
        userCollection.updateOne(
            {"_id" : new ObjectId(receiverId)},
            {$push : { "friendReqs" : new ObjectId(senderId) }}
        )
    } else {
        userCollection.updateOne(
            {"_id" : new ObjectId(receiverId)},
            {$pull : { "friendReqs" : new ObjectId(senderId) }}
        )
    }
    res.send("OK")
})

/**
 * Deals with user accepting/rejecting a request
 * Requires: accepted (boolean), sender (String), and receiver (String) are sent in the request
 */
app.post('/determineFriend', bp.json(), (req, res) => {
    const accepted = req.body.accepted;
    const senderId = new ObjectId(req.body.sender);
    const receiverId = new ObjectId(req.body.receiver);
    userCollection.updateOne(
        {"_id" : receiverId},
        {$pull : { "friendReqs" : senderId } }
    )
    if (accepted) {
        userCollection.updateOne(
            {"_id" : receiverId},
            {$push : { "friends" : senderId }}
        )
    }
    res.send("OK")
})

/**
 * Handles user's RSVP to an event
 * Requires: user (String), event (String), and action (String) are supplied in request body
 * Requires: action (String) is either 'accepted' or 'rejected'
 */
app.post('/eventRSVP', bp.json(), (req, res) => {
    const userId = new ObjectId(req.body.user);
    const eventId = new ObjectId(req.body.event);
    const action = req.body.action;
    userCollection.updateOne(
        {"_id" : userId},
        {$pull : { "pendingEvents" : eventId }}
    )
    if (action === "accepted") {
        userCollection.updateOne(
            {"_id" : userId},
            {$push : { "acceptedEvents" : eventId }}
        )
        eventCollection.updateOne(
            {"_id" : eventId},
            {$push : { "attendees" : userId }}
        )
    } else {
        userCollection.updateOne(
            {"_id" : userId},
            {$push : { "rejectedEvents" : eventId }}
        )
    }
    res.send("OK")
})

app.use(function (req, res, next){
	res.status(404).send('Unable to find the requested resource!');
});

const server = app.listen(process.env.PORT || 8080, () => {
    console.log("✅: Server is up and running")
    client.connect(err => {
        if (err) throw err;
        db = client.db("AppData");
        chatCollection = db.collection("Chats");
        eventCollection = db.collection("Events");
        userCollection = db.collection("Users");
        expoServer = new Expo({ accessToken: process.env.EXPO_TOKEN  });
    })
})

const handler = new socketHandler(server);