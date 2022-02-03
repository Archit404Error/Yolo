import { MongoClient, ObjectId } from 'mongodb';
import { Expo } from 'expo-server-sdk';
import bp from 'body-parser';
import express from 'express';
import nodeGeocoder from 'node-geocoder';

import socketHandler from './socketHandler.js';
import { pointDist, sendNotifs } from './helperMethods.js';

const app = express();
const locationFinder = nodeGeocoder({
    provider : 'openstreetmap',
})

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
var db, chatCollection, eventCollection, userCollection, expoServer;
var handler;

/** 
 * Returns JSON data of event with a given id
 */
app.get('/event/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send("Incorrectly formatted request");
    eventCollection.findOne({"_id" : new ObjectId(req.params.id)}, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/**
 * Returns JSON data of all events created by a specific user
 */
app.get('/createdEvents/:userId', async (req, res) => {
    if (!req.params.userId) return res.status(500).send("Incorrectly formatted request");
    const eventDataList = await eventCollection.find({"creator" : new ObjectId(req.params.userId)}).toArray();
    res.send(eventDataList);
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
    const found = chatCollection.find({"members._id" : new ObjectId(req.params.id)});
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
 * Returns a list consisting of ids of a user's friends who posted stories
 */
 app.get('/storyIds/:id', async (req, res) => {
     if (!req.params.id) return res.status(500).send("No id supplied!");
     const result = await userCollection.aggregate([
        {
            $match: {
                "friends" : { $all: [new ObjectId(req.params.id)] },
            }
        },
        {
            $project: {
                "_id" : 1,
                "storyImage" : { $ifNull : ["$storyImage", null] }
            }
        }
     ]).toArray();
     result.filter(elem => elem.storyImage != null);
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
        "_id" : new ObjectId(),
        "username" : username,
        "password" : password,
        "name" : name,
        "rejectedEvents" : [],
        "acceptedEvents" : [],
        "pendingEvents" : [],
        "chats": [],
        "friends" : [],
        "friendReqs" : [],
        "profilePic" : "https://firebasestorage.googleapis.com/v0/b/eventapp-73ba7.appspot.com/o/Profiles%2Fdefault_user.png?alt=media&token=c4f609d3-a714-4d70-8383-ac59368ac640",
        "tokens" : []
    }
    userCollection.insertOne(userData)
    // send data back to client to be stored
    res.send(userData);
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
    const creator = new ObjectId(req.body.creator);
    const image = req.body.image;
    const title = req.body.title;
    const desc = req.body.description;
    const loc = req.body.location;
    const startDate = req.body.startDate;
    const endDate = req.body.endDate;
    const tags = req.body.tags;
    const other = req.body.other;
    let longitude = 0;
    let latitude = 0;

    const eventId = new ObjectId();

    handler.sendUserEvent(req.body.creator, "userCreatedEvent");

    locationFinder.geocode(loc)
        .then(res => res[0])
        .then(actualRes => {
            longitude = actualRes.longitude;
            latitude = actualRes.latitude;
        })
        .then(() => {
            eventCollection.insertOne({
                "_id" : eventId,
                "creator" : creator,
                "image" : image,
                "title" : title,
                "description" : desc,
                "location" : loc,
                "startDate" : startDate,
                "endDate" : endDate,
                "tags" : tags,
                "latitude" : latitude,
                "longitude" : longitude,
                "other" : other,
                "attendees" : [],
                "viewers" : [],
                "rejecters" : []
            })
        })
    
    chatCollection.insertOne({
        "creator" : creator,
        "event" : eventId,
        "messages" : [],
        "members" : []
    })

    res.send(eventId)
})

/**
 * Records a message sent by a user in a chat
 */
app.post('/sendMessage', bp.json(), (req, res) => {
    const senderName = req.body.sender;
    const message = req.body.message;
    const chatId = req.body.chat;
    const chatName = req.body.title;

    if (!senderName || !message || !chatId || !chatName) {
        return res.status(500).send("Incorrectly formatted request");
    }

    const messageObj = {
        sender: senderName,
        message: message
    }

    chatCollection.findOneAndUpdate(
        {"_id" : new ObjectId(chatId)},
        {$push : { "messages" : messageObj } },
        {returnNewDocument: true}
    )
        .then(updatedDoc => {
            let notifs = [];
            for (const member of updatedDoc.value.members) {
                member.tokens.forEach(token => 
                    notifs.push({
                        to: token,
                        sound: 'default',
                        title: chatName,
                        body: `${member.name}: ${message}`,
                        data: {},
                    })
                )
            }

            sendNotifs(notifs, expoServer);
        })
    res.send("OK")
})

/**
 * Sends / Revokes a friend request
 * Requires: sender (String ObjId), name (String), and receiver (String ObjId) are sent in the request
 */
app.post('/friendReq', bp.json(), async (req, res) => {
    const senderId = new ObjectId(req.body.sender);
    const senderName = req.body.name;
    const receiverId = new ObjectId(req.body.receiver);
    const wantToFriend = req.body.wantToFriend;
    const receiverTokens = (await userCollection.findOne({"_id" : receiverId})).tokens;

    if (wantToFriend) {
        userCollection.updateOne(
            {"_id" : new ObjectId(receiverId)},
            {$push : { "friendReqs" : new ObjectId(senderId) }}
        )
        let notifs = [];
        (await receiverTokens).forEach(token => {
            notifs.push({
                to: token,
                sound: 'default',
                title: 'New friend request',
                body: `${senderName} sent you a friend request`,
                data: {}
            })
        })
        sendNotifs(notifs, expoServer);
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
 * Requires: accepted (boolean), sender (String), name(String), and receiver (String) are sent in the request
 */
app.post('/determineFriend', bp.json(), async (req, res) => {
    const accepted = req.body.accepted;
    const senderId = new ObjectId(req.body.sender);
    const receiverId = new ObjectId(req.body.receiver);
    const receiverName = req.body.name;
    const senderTokens = (await userCollection.findOne({"_id" : senderId})).tokens;
    userCollection.updateOne(
        {"_id" : receiverId},
        {$pull : { "friendReqs" : senderId } }
    )
    if (accepted) {
        userCollection.updateOne(
            {"_id" : receiverId},
            {$push : { "friends" : senderId }}
        )
        userCollection.updateOne(
            {"_id" : senderId},
            {$push : { "friends" : receiverId } }
        )
        let notifs = [];
        senderTokens.forEach(token => {
            notifs.push({
                to: token,
                sound: 'default',
                title: 'Friend Request Accepted',
                body: `${receiverName} accepted your friend request`
            })
        })

        sendNotifs(notifs, expoServer);
    }
    res.send("OK")
})

/**
 * Enables user to send invite to a friend
 */
app.post('/inviteFriend', bp.json(), (req, res) => {
    const senderId = new ObjectId(req.body.sender);
    const eventId = new ObjectId(req.body.event);
    const friendId = new ObjectId(req.body.friend);

    userCollection.updateOne(
        {"_id" : friendId},
        { $push: { "pendingEvents" : eventId } }
    )

    // Eventually we will store user notifs so that people can see who invited them
    res.send("OK")
})

/**
 * A resource-heavy time consuming friend suggestion algorithm
 */
app.post('/populateFriends', bp.json(), async (req, res) => {
    const userId = req.body.user;
    // an acquantaince is a friend of a friend
    let acquaintanceOccurrences = {};
    let userFriends = new Set();
    const friendCursor = userCollection.find({ "friends" : { $all : [new ObjectId(userId)] } })
    const friendDocs = await friendCursor.toArray();

    for (const friendDoc of await friendDocs) {
        userFriends.add(friendDoc._id);
        friendDoc.friends.forEach(id => {
            if (id != userId) {
                // Compute weighted importance of connection (edge weight in friend graph)
                const weight = 1 / friendDoc.friends.length;
                if (acquaintanceOccurrences[id])
                    acquaintanceOccurrences[id] += weight;
                else
                    acquaintanceOccurrences[id] = weight;
            }
        })
    }

    const pastEventDetails = await userCollection.aggregate([
        { $match : { "_id" : new ObjectId(userId) } },
        { 
            $lookup : {
                from : "Events",
                localField: "acceptedEvents",
                foreignField: "id",
                as: "eventDetails"
            }
        },
        { $project: { "eventDetails" : 1 } }
    ]).eventDetails

    for (const eventDoc of await pastEventDetails) {
        eventDoc.attendees.forEach(id => {
            if (id != userId) {
                // Compute weight based on number of attendees of event
                const weight = 1 / eventDoc.attendees.length;
                if (acquaintanceOccurrences[id])
                    acquaintanceOccurrences[id] += weight;
                else
                    acquaintanceOccurrences[id] = weight;
            }
        })
    }

    // Store top 5 most occurring acquaintances and remove existing friends
    const topRec = Object.entries(acquaintanceOccurrences)
                    .sort(([,a], [,b]) => a - b)
                    .map(freqArr => freqArr[0])
                    .filter(id => userFriends.has(id))
                    .filter((elem, index) => index < 5)

    userCollection.updateOne(
        {"_id" : new ObjectId(userId)},
        { $set : { "friendRecommendations" : topRec } }
    )

    res.send("Populated")
})

/**
 * Stores a user's event suggestions
 */
app.post('addEventSuggestions', async (req, res) => {
    const userId = req.body.user;
    const userDoc = await userCollection.findOne({ "_id" : new ObjectId(userId) });
    // continue adding logic here...
})

/**
 * Handles user's RSVP to an event
 * Requires: user (String), event (String), and action (String) are supplied in request body
 */
app.post('/eventRSVP', bp.json(), async (req, res) => {
    const userId = new ObjectId(req.body.user);
    const eventId = new ObjectId(req.body.event);
    const action = req.body.action;
    if (!userId || !eventId || !action) {
        return res.status(500).send("Invalid params supplied")
    }

    if (action === "accepted") {
        userCollection.updateOne(
            {"_id" : userId},
            {$push : { "acceptedEvents" : eventId }}
        )

        eventCollection.updateOne(
            {"_id" : eventId},
            {$push : { "attendees" : userId }}
        )
        
        const userData = await userCollection.findOne(
            {"_id" : userId}
        )

        chatCollection.findOneAndUpdate(
            {"event" : eventId},
            {$push : { "members" : await userData }}
        )
            .then(found => {
                userCollection.updateOne(
                    {"_id" : userId},
                    {$push : { "chats" : new ObjectId(found.value._id) }}
                )
                handler.sendUserEvent(req.body.user, "eventsUpdated");
            })
    } else if (action == "viewed") {
        userCollection.updateOne(
            {"_id" : userId},
            {$addToSet : { "viewedEvents" : eventId }}
        )

        eventCollection.updateOne(
            {"_id" : eventId},
            {$addToSet : { "viewers" : userId }}
        )

        return;
    } else {
        userCollection.updateOne(
            {"_id" : userId},
            {$push : { "rejectedEvents" : eventId }}
        )

        eventCollection.updateOne(
            {"_id" : eventId},
            {$addToSet : { "rejecters" : userId }}
        )
    }

    userCollection.updateOne(
        {"_id" : userId},
        {$pull : { "pendingEvents" : eventId }}
    )

    const creator = (await eventCollection.findOne({"_id" : eventId})).creator;
    handler.sendUserEvent(await creator, "RSVPOcurred")

    res.send("OK")
})

/**
 * Uploads a users story image
 * Requires: user (String) and image (String) are supplied in the body of the request
 */
app.post('/uploadStory', bp.json(), (req, res) => {
    const userId = new ObjectId(req.body.user);
    const imageUrl = req.body.image;
    userCollection.updateOne(
        {"_id" : userId},
        {$set : { "storyImage" : imageUrl } }
    )
})

app.use((req, res, next) => {
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

handler = new socketHandler(server);