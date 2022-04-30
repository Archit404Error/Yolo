import { MongoClient, ObjectId } from 'mongodb';
import { Expo } from 'expo-server-sdk';
import bp from 'body-parser';
import express, { query } from 'express';
import nodeGeocoder from 'node-geocoder';

import socketHandler from './socketHandler.js';
import { pointDist, sendNotifs, hoursToMillis } from './helperMethods.js';
import { populateFriends, populateAllFriends } from './suggestionEngines/friendSuggestionEngine.js';
import {
    populateEventSuggestions,
    populateAllEventSuggestions
} from './suggestionEngines/eventSuggestionEngine.js';

const app = express();
const locationFinder = nodeGeocoder({
    provider: 'openstreetmap',
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
    eventCollection.findOne({ "_id": new ObjectId(req.params.id) }, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/**
 * Returns JSON data of all events created by a specific user
 */
app.get('/createdEvents/:userId', async (req, res) => {
    if (!req.params.userId) return res.status(500).send("Incorrectly formatted request");
    const eventDataList = await eventCollection.find({ "creator": new ObjectId(req.params.userId) }).toArray();
    res.send(eventDataList);
})

/**
 * Returns JSON data of user with a given id
 */
app.get('/user/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    userCollection.findOne({ "_id": new ObjectId(req.params.id) }, (error, result) => {
        if (error) return res.status(500).send(error);
        res.send(result);
    })
})

/**
 * Loads all chats for a user based on user's id
 */
app.get('/userChats/:id', async (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    const found = chatCollection.find({ "members._id": new ObjectId(req.params.id) });
    if ((await found.count()) == 0) return res.send([])
    res.send(await found.toArray())
})

/**
 * Returns JSON data of chat with a given id
 */
app.get('/chat/:id', (req, res) => {
    if (!req.params.id) return res.status(500).send("ID Error");
    chatCollection.findOne({ "_id": new ObjectId(req.params.id) }, (error, result) => {
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
            $match: { "_id": new ObjectId(req.params.id) }
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
                "friends": { $all: [new ObjectId(req.params.id)] },
            }
        },
        {
            $project: {
                "_id": 1,
                "storyImage": { $ifNull: ["$storyImage", null] }
            }
        }
    ]).toArray();
    result.filter(elem => elem.storyImage != null);
    res.send(result);
})

/**
 * Returns a user's upcoming events
 */
app.get('/upcomingEvents/:id', async (req, res) => {
    const user = new ObjectId(req.params.id)
    const accepted = (await userCollection.findOne({ "_id": user })).acceptedEvents
    res.json((await accepted)
        .filter(event => new Date(event.startDate) > new Date())
        .sort((fst, snd) => new Date(fst.startDate) - new Date(snd.startDate))
    )
})

/**
 * Returns a set of relevant event and user ids when a user searches for an event or a user.
 */
app.get('/searchSuggestions/:query', async (req, res) => {
    const nameIds = await userCollection.aggregate([
        {
            $match: {
                "name": { $regex: `${req.params.query}`, $options: 'i' },
            }
        },
        {
            $project: {
                "_id": 1,
                "username": 1,
                "name": 1,
                "profilePic": 1
            }
        }
    ]).toArray();
    const eventIds = await eventCollection.aggregate([
        {
            $match: {
                "title": { $regex: `${req.params.query}`, $options: 'i' }
            }
        },
        {
            $project: {
                "_id": 1,
                "title": 1,
                "image": 1,
                "location": 1
            }
        }
    ]).toArray();
    let returnArr = [...eventIds, ...nameIds]
    res.send(Array.from(returnArr));
});


/**
 * Authenticates users by returning JSON data if auth suceeds, else returns empty response
 */
app.post('/auth', bp.json(), (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (!username || !password) return res.status(500).send("Authentication Error")
    userCollection.findOne({ "username": username, "password": password }, (err, result) => {
        if (err) return res.status(500).send(err);
        if (result == null) return res.send({});
        res.send(result);
    });
})

/**
 * Inserts a new user into the DB
 */
app.post('/register', bp.json(), async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    const name = req.body.name;

    const exists = await userCollection.find({ "username": username }).count()

    if (await exists == 0) {
        const userData = {
            "_id": new ObjectId(),
            "username": username,
            "password": password,
            "name": name,
            "rejectedEvents": [],
            "acceptedEvents": [],
            "pendingEvents": [],
            "chats": [],
            "friends": [],
            "notifications": [],
            "profilePic": "https://firebasestorage.googleapis.com/v0/b/eventapp-73ba7.appspot.com/o/Profiles%2Fdefault_user.png?alt=media&token=c4f609d3-a714-4d70-8383-ac59368ac640",
            "tokens": []
        }
        userCollection.insertOne(userData)
        // send data back to client to be stored
        res.send(userData);
    } else {
        res.send("not allowed")
    }
})

/**
 * Assigns a push token to a user
 */
app.post('/registerPushToken', bp.json(), (req, res) => {
    const userId = req.body.user;
    const token = req.body.token;
    userCollection.updateOne(
        { "_id": new ObjectId(userId) },
        { $addToSet: { "tokens": token } }
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
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);
    const tags = req.body.tags.split("|");
    const other = req.body.other;
    const isPublic = req.body.public;
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
                "_id": eventId,
                "creator": creator,
                "image": image,
                "title": title,
                "description": desc,
                "location": loc,
                "startDate": startDate,
                "endDate": endDate,
                "tags": tags,
                "latitude": latitude,
                "longitude": longitude,
                "other": other,
                "attendees": [],
                "viewers": [],
                "rejecters": [],
                "public": isPublic
            })
        })

    chatCollection.insertOne({
        "creator": creator,
        "event": eventId,
        "messages": [],
        "members": []
    })

    res.send(eventId)
})

/**
 * Records a message sent by a user in a chat
 * Sends push notif
 */
app.post('/sendMessage', bp.json(), (req, res) => {
    const senderName = req.body.sender;
    const message = req.body.message;
    const chatId = req.body.chat;
    const chatName = req.body.title;

    if (!senderName || !message || !chatId || !chatName)
        return res.status(500).send("Incorrectly formatted request");

    const messageObj = {
        sender: senderName,
        message: message
    }

    chatCollection.findOneAndUpdate(
        { "_id": new ObjectId(chatId) },
        { $push: { "messages": messageObj } },
        { returnNewDocument: true }
    )
        .then(updatedDoc => {
            for (const member of updatedDoc.value.members) {
                if (member.username != senderName)
                    sendNotifs(member.tokens, chatName, `${senderName}: ${message}`, expoServer)
            }
        })
    res.send("OK")
})

/**
 * Sends / Revokes a friend request
 * Requires: sender (String ObjId), name (String), and receiver (String ObjId) are sent in the request
 * Sends push notif
 */
app.post('/friendReq', bp.json(), async (req, res) => {
    const senderId = new ObjectId(req.body.sender);
    const senderName = req.body.name;
    const receiverId = new ObjectId(req.body.receiver);
    const wantToFriend = req.body.wantToFriend;
    const receiverTokens = (await userCollection.findOne({ "_id": receiverId })).tokens;

    if (wantToFriend) {
        userCollection.updateOne(
            { "_id": new ObjectId(receiverId) },
            {
                $push:
                {
                    "notifications": {
                        type: "friend",
                        sender: new ObjectId(senderId)
                    }
                }
            }
        )

        sendNotifs(
            await receiverTokens,
            'New friend request',
            `${senderName} sent you a friend request`,
            expoServer
        )

        handler.sendUserEvent(req.body.receiver, "notificationsUpdated");
    } else {
        userCollection.updateOne(
            { "_id": new ObjectId(receiverId) },
            {
                $pull:
                {
                    "notifications": {
                        type: "friend",
                        sender: new ObjectId(senderId)
                    }
                }
            }
        )
    }
    res.send("OK")
})

/**
 * Deals with user accepting/rejecting a request
 * Requires: accepted (boolean), sender (String), name(String), and receiver (String) are sent in the request
 * Sends push notif (if accepted)
 */
app.post('/determineFriend', bp.json(), async (req, res) => {
    const accepted = req.body.accepted;
    const senderId = new ObjectId(req.body.sender);
    const receiverId = new ObjectId(req.body.receiver);
    const receiverName = req.body.name;
    const senderTokens = (await userCollection.findOne({ "_id": senderId })).tokens;
    userCollection.updateOne(
        { "_id": receiverId },
        {
            $pull:
            {
                "notifications": {
                    type: "friend",
                    sender: senderId
                }
            }
        }
    )
    if (accepted) {
        userCollection.updateOne(
            { "_id": receiverId },
            { $push: { "friends": senderId } }
        )
        userCollection.updateOne(
            { "_id": senderId },
            {
                $push:
                {
                    "friends": receiverId,
                    "notifications": {
                        type: "newfriend",
                        friend: receiverId
                    }
                }
            }
        )

        sendNotifs(
            senderTokens,
            'Friend Request Accepted',
            `${receiverName} accepted your friend request`,
            expoServer
        )
    }
    res.send("OK")
})

/**
 * Enables user to send invite to a friend for an event
 * Sends push notif
 */
app.post('/inviteFriend', bp.json(), (req, res) => {
    const senderId = new ObjectId(req.body.sender);
    const senderName = req.body.senderName;
    const friendId = new ObjectId(req.body.friend);
    const eventId = new ObjectId(req.body.event);
    const eventName = req.body.eventName;

    userCollection.findOneAndUpdate(
        { "_id": friendId },
        {
            $addToSet: { "pendingEvents": eventId },
            $push: {
                "notifications": {
                    type: "invite",
                    sender: senderId,
                    senderName: senderName,
                    event: eventId,
                    eventName: eventName
                }
            }
        }
    )
        .then(friendDoc => {
            sendNotifs(
                friendDoc.value.tokens, 'New Event Invitation',
                `${senderName} just invited you to attend ${eventName}!`,
                expoServer
            )
        })
    handler.sendUserEvent(req.body.friend, "notificationsUpdated");
    res.send("OK")
})

/**
 * An endpoint to populate friend suggestions
 */
app.post('/populateFriends', bp.json(), async (req, res) =>
    res.send(await populateFriends(userCollection, new ObjectId(req.body.user)))
)

/**
 * An endpoint to populate event suggestions
 */
app.post('/addEventSuggestions', bp.json(), async (req, res) => {
    const userId = req.body.user;
    res.send(await populateEventSuggestions(userCollection, eventCollection, new ObjectId(userId)))
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
        const eventData = await eventCollection.findOne({ "_id": eventId })

        userCollection.updateOne(
            { "_id": userId },
            { $push: { "acceptedEvents": await eventData } }
        )

        eventCollection.updateOne(
            { "_id": eventId },
            { $push: { "attendees": userId } }
        )

        const userData = await userCollection.findOne(
            { "_id": userId }
        )

        chatCollection.findOneAndUpdate(
            { "event": eventId },
            { $push: { "members": await userData } }
        )
            .then(found => {
                userCollection.updateOne(
                    { "_id": userId },
                    { $push: { "chats": new ObjectId(found.value._id) } }
                )
                handler.sendUserEvent(req.body.user, "eventsUpdated");
            })
    } else if (action == "viewed") {
        userCollection.updateOne(
            { "_id": userId },
            { $addToSet: { "viewedEvents": eventId } }
        )

        eventCollection.updateOne(
            { "_id": eventId },
            { $addToSet: { "viewers": userId } }
        )

        return;
    } else {
        userCollection.updateOne(
            { "_id": userId },
            { $push: { "rejectedEvents": eventId } }
        )

        eventCollection.updateOne(
            { "_id": eventId },
            { $addToSet: { "rejecters": userId } }
        )
    }

    userCollection.updateOne(
        { "_id": userId },
        { $pull: { "pendingEvents": eventId } }
    )

    const creator = (await eventCollection.findOne({ "_id": eventId })).creator;
    handler.sendUserEvent(await creator, "RSVPOcurred")

    res.send("OK")
})

app.post('/rejectAcceptedEvent/', bp.json(), async (req, res) => {
    const eventId = new ObjectId(req.body.event);
    const userId = new ObjectId(req.body.user);
    const eventData = await eventCollection.findOne({ "_id": eventId })
    try {
        userCollection.updateOne(
            { "_id": userId },
            { $pull: { "acceptedEvents": await eventData } }
        )
        eventCollection.updateOne(
            { "_id": eventId },
            { $pull: { "attendees": userId } }
        )
        const userData = await userCollection.findOne(
            { "_id": userId }
        )
        chatCollection.findOneAndUpdate(
            { "event": eventId },
            { $pull: { "members": await userData } }
        )
            .then(found => {
                userCollection.updateOne(
                    { "_id": userId },
                    { $pull: { "chats": new ObjectId(found.value._id) } }
                )
                handler.sendUserEvent(req.body.user, "eventsUpdated");
            })
    } catch {
        res.send("Error occurred.");
    }
    res.send(`Removed ${userId} from ${eventId}`)
})


/**
 * Uploads a users story image
 * Requires: user (String) and image (String) are supplied in the body of the request
 */
app.post('/uploadStory', bp.json(), (req, res) => {
    const userId = new ObjectId(req.body.user);
    const imageUrl = req.body.image;
    userCollection.updateOne(
        { "_id": userId },
        { $set: { "storyImage": imageUrl } }
    )
})

/**
 * Dummy endpoint used to repopulate pending events for given user when testing
 */
app.post('/dummyEvents', bp.json(), (req, res) => {
    const userId = new ObjectId(req.body.user);
    userCollection.updateOne(
        { "_id": userId },
        {
            $push: {
                "pendingEvents": {
                    $each: [
                        new ObjectId("61c53b35d5a5c3d50bfca80f"),
                        new ObjectId("61c6ad10a4df23bbaa6c3f37"),
                        new ObjectId("61e751bf335d915168795d6c"),
                        new ObjectId("61e9fa18cd57906abf1c091a"),
                        new ObjectId("61e9fb59cd57906abf1c091e")
                    ]
                }
            }
        }
    )
    res.send("OK")
})

app.post('/updateProfilePic', bp.json(), (req, res) => {
    const userId = new ObjectId(req.body.user);
    const imgUrl = req.body.imgUrl;
    userCollection.updateOne(
        { "_id": userId },
        { $set: { "profilePic": imgUrl } }
    )
    res.send('success');
});


app.post('/uploadEventStory/', bp.json(), (req, res) => {
    const eventId = new ObjectId(req.body.event);
    const imageUrl = req.body.image;
    eventCollection.insert(
        { "_id": eventId },
        {
            $push: {
                storyImages: imageUrl
            }
        }
    )
    res.send(imageUrl)
})

app.post('/updateEvent/', bp.json(), (req, res) => {
    const eventId = req.body.id
    const creator = new ObjectId(req.body.creator);
    const image = req.body.image;
    const title = req.body.title;
    const desc = req.body.description;
    const loc = req.body.location;
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);
    const tags = req.body.tags.split("|");
    const other = req.body.other;
    const isPublic = req.body.public;
    eventCollection.updateOne(
        { "_id": eventId },
        {
            $set: {
                "_id": eventId,
                "creator": creator,
                "image": image,
                "title": title,
                "description": desc,
                "location": loc,
                "startDate": startDate,
                "endDate": endDate,
                "tags": tags,
                "public": isPublic
            }
        });
    res.send(eventId)
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
        setInterval(() => populateAllFriends(userCollection), hoursToMillis(0.1))
        setInterval(() => populateAllEventSuggestions(userCollection, eventCollection), hoursToMillis(0.1))
        expoServer = new Expo({ accessToken: process.env.EXPO_TOKEN });
    })
})

handler = new socketHandler(server);
