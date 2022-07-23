import { MongoClient, ObjectId } from 'mongodb';
import { Expo } from 'expo-server-sdk';
import bp from 'body-parser';
import cors from 'cors';
import express from 'express';
import aws from 'aws-sdk';
import multer from 'multer';
import multerS3 from 'multer-s3';
import nodeGeocoder from 'node-geocoder';

import socketHandler from './socketHandler.js';
import { pointDist, sendNotifs, hoursToMillis, successJson, errorJson } from './helperMethods.js';
import { populateFriends, populateAllFriends } from './suggestionEngines/friendSuggestionEngine.js';
import {
    populateEventSuggestions,
    populateAllEventSuggestions
} from './suggestionEngines/eventSuggestionEngine.js';
import fetch from 'node-fetch';
import { v4 } from 'uuid';

export const runYoloBackend = () => {
    const app = express();
    app.use(cors())

    const locationFinder = nodeGeocoder({
        provider: 'openstreetmap',
    })

    const uri = process.env.MONGO_URI;
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    var db, chatCollection, eventCollection, userCollection, expoServer;
    var handler;

    const s3 = new aws.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.REGION,
    })

    const bucket = process.env.AWS_BUCKET;

    const upload = multer({
        storage: multerS3({
            s3,
            bucket: bucket,
            acl: 'public-read',
            metadata(req, file, cb) {
                cb(null, { fieldName: file.fieldname });
            },
            key(req, file, cb) {
                cb(null, `${v4()}.${file.originalname.split('.').pop()}`);
            }
        })
    })


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
     * Returns a list of story ids by accepted event for user
     */
    app.get('/eventStories/:id', async (req, res) => {
        const userId = new ObjectId(req.params.id);

        const resStories = await userCollection.aggregate([
            {
                $match: { "_id": userId }
            },
            {
                $lookup: {
                    from: 'Events',
                    localField: 'acceptedEvents._id',
                    foreignField: '_id',
                    as: 'eventData'
                }
            },
            {
                $project: {
                    "eventData.storyImages": 1,
                    "eventData.image": 1,
                    "eventData._id": 1
                }
            },
            {
                $unwind: { path: "$eventData" }
            }
        ]).toArray();

        let stories = [];
        resStories.forEach(event => {
            let images = event.eventData.storyImages;
            let data = {};
            if (images) {
                data.id = event.eventData._id;
                data.preview = event.eventData.image;
                data.storyImages = images;
                stories.push(data);
            }
        });

        res.send(stories);
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
    app.get('/searchSuggestions/:userId/:query', async (req, res) => {
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
            }
        ]).toArray();

        const blockedUsers = (await userCollection.findOne({ "_id": new ObjectId(req.params.userId) })).blockedUsers;

        let returnArr = Array.from([...eventIds, ...nameIds])
        returnArr = returnArr.filter(item => !blockedUsers.some(id => id.equals(item._id)))
        res.send(returnArr);
    });

    app.get('/eventStory/:event', async (req, res) => {
        const eventId = new ObjectId(req.params.event)
        const foundStory = await eventCollection.aggregate([
            {
                $match: { "_id": eventId }
            },
            {
                $project: {
                    "_id": 0,
                    "storyImages": 1
                }
            }
        ]).next()

        res.send(await foundStory["storyImages"])
    })

    /**
     * Determines the user's "position" a given event story
     * @return the index of first image in storyImages that has not been viewed, or -1 if all viewed
     */
    app.get('/storyPosition/:user/:event', async (req, res) => {
        const userId = new ObjectId(req.params.user);
        const eventId = new ObjectId(req.params.event);

        const eventStories = (await eventCollection.findOne({ "_id": eventId })).storyImages;
        eventStories.forEach((storyObj, index) => {
            if (!res.headersSent && !storyObj.viewers.some(id => id.equals(userId))) {
                res.send({ position: index });
            }
        })

        if (res.headersSent)
            return

        res.send({ position: -1 })
    })

    app.get('/reports', async (req, res) => {
        const reports = await eventCollection.find(
            { reports: { $exists: true } },
            { _id: 1, reports: 1 }
        ).toArray();

        let aggrReports = [];
        reports.forEach(report => {
            report.reports.forEach(rep => {
                rep.event = report._id;
                aggrReports.push(rep);
            })
        })

        res.send(aggrReports)
    })

    app.get('/signedUrl/:key', (req, res) => {
        const url = s3.getSignedUrl('putObject', {
            Bucket: bucket,
            Key: req.params.key,
            Expires: 60
        });
        res.send(successJson(url));
    })

    /**
     * Uploads image to S3
     * Takes in form data with key photo and value being the file
     */
    app.post('/upload', upload.single('photo'), (req, res) => {
        let cdnUrl = req.file.location.replace(`${bucket}.s3.amazonaws.com`, process.env.CDN_DISTR)
        res.send(successJson(cdnUrl))
    })


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
                "profilePic": "https://d3ui31b996myii.cloudfront.net/default_user.png",
                "blockedUsers": [],
                "blockedBy": [],
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
    app.post('/create', bp.json(), async (req, res) => {
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

        const eventId = new ObjectId();

        handler.sendUserEvent(req.body.creator, "userCreatedEvent");

        const eventData = {
            "_id": eventId,
            "creator": creator,
            "image": image,
            "title": title,
            "description": desc,
            "location": loc,
            "startDate": startDate,
            "endDate": endDate,
            "tags": tags,
            "other": other,
            "attendees": [],
            "viewers": [],
            "rejecters": [],
            "public": isPublic
        }

        if (!req.body.latitude) {
            const result = await locationFinder.geocode(loc)
            const actualRes = result[0]

            if (actualRes) {
                eventData.longitude = actualRes.longitude;
                eventData.latitude = actualRes.latitude;

                eventCollection.insertOne(eventData)

                chatCollection.insertOne({
                    "creator": creator,
                    "event": eventId,
                    "messages": [],
                    "members": [],
                    "lastUpdate": Date.now()
                })

                res.send(successJson(eventId))
            } else {
                res.send(errorJson("location"))
            }
        } else {
            eventData.longitude = req.body.longitude;
            eventData.latitude = req.body.latitude;

            eventCollection.insertOne(eventData)

            chatCollection.insertOne({
                "creator": creator,
                "event": eventId,
                "messages": [],
                "members": [],
                "lastUpdate": Date.now()
            })

            res.send(successJson(eventId))
        }
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
            {
                $push: { "messages": messageObj },
                $set: { "lastUpdate": Date.now(), "members.$[].read": false }
            },
            { returnNewDocument: true }
        )
            .then(updatedDoc => {
                for (const member of updatedDoc.value.members) {
                    if (member.username != senderName)
                        sendNotifs(member.tokens, chatName, `${senderName}: ${message}`, expoServer)
                }
            })
        res.send(successJson("OK"))
    })

    /**
     * Marks a user as having read a chat
     * Requires: user (String), and chat (String)
     */
    app.post('/chatRead', bp.json(), (req, res) => {
        const userId = new ObjectId(req.body.user);
        const chatId = new ObjectId(req.body.chat);

        chatCollection.updateOne(
            { "_id": chatId },
            { $set: { "members.$[readMem].read": true } },
            { arrayFilters: [{ "readMem._id": userId }] }
        )

        res.send(successJson("OK"))
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
                            _id: new ObjectId(),
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
                            _id: new ObjectId(),
                            type: "friend",
                            sender: new ObjectId(senderId)
                        }
                    }
                }
            )
        }
        res.send(successJson("OK"))
    })

    app.post('/unfriend', bp.json(), (req, res) => {
        const userId = new ObjectId(req.body.user);
        const friendId = new ObjectId(req.body.friend);

        userCollection.updateOne(
            { "_id": userId },
            { $pull: { "friends": friendId } }
        )

        userCollection.updateOne(
            { "_id": friendId },
            { $pull: { "friends": userId } }
        )

        res.send(successJson("OK"))
    })

    /**
     * Determines whether two users are friends or not
     */
    app.post('/isFriend', bp.json(), async (req, res) => {
        const viewed = new ObjectId(req.body.viewed);
        const viewer = new ObjectId(req.body.viewer);
        const equalsViewer = obj => JSON.stringify(obj) == JSON.stringify(viewer);
        const viewedRecord = (await userCollection.findOne({ "_id": viewed }));
        const viewedFriends = (await viewedRecord).friends;
        const isPending = (await viewedRecord).notifications
            .filter(notif => notif.type == "friend" && equalsViewer(notif.sender))
            .length > 0;
        const isFriend = viewedFriends.filter(equalsViewer).length > 0;
        res.send({ friend: isFriend, pending: isPending })
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
                            _id: new ObjectId(),
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

            handler.sendUserEvent(req.body.sender, "notificationsUpdated");
            handler.sendUserEvent(req.body.sender, "friendChange");
            handler.sendUserEvent(req.body.receiver, "friendChange");
        }
        res.send(successJson("OK"))
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
                        _id: new ObjectId(),
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
        res.send(successJson("OK"))
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

    app.post('/deleteNotif', bp.json(), (req, res) => {
        const userId = new ObjectId(req.body.user);
        const notifId = new ObjectId(req.body.notif);
        userCollection.updateOne(
            { "_id": userId },
            { $pull: { "notifications": { "_id": notifId } } }
        )
        res.send(successJson("OK"))
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

            let userData = {
                ... await userCollection.findOne({ "_id": userId }),
                read: false
            }

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

        res.send(successJson("OK"))
    })

    app.post('/undoAcceptEvent', bp.json(), async (req, res) => {
        const eventId = new ObjectId(req.body.event);
        const userId = new ObjectId(req.body.user);

        userCollection.updateOne(
            { "_id": userId },
            {
                $pull: { "acceptedEvents": { "_id": eventId } },
                $push: { "pendingEvents": eventId }
            }
        )

        eventCollection.updateOne(
            { "_id": eventId },
            { $pull: { "attendees": userId } }
        )

        const chatDoc = await chatCollection.findOneAndUpdate(
            { "event": eventId },
            { $pull: { "members": { "_id": userId } } }
        )

        userCollection.updateOne(
            { "_id": userId },
            { $pull: { "chats": new ObjectId(chatDoc.value._id) } }
        )

        handler.sendUserEvent(req.body.user, "eventsUpdated");
        res.send(successJson({ chatId: chatDoc.value._id }))
    })

    app.post('/undoRejectEvent', bp.json(), async (req, res) => {
        const eventId = new ObjectId(req.body.event);
        const userId = new ObjectId(req.body.user);

        userCollection.updateOne(
            { "_id": userId },
            {
                $pull: { "rejectedEvents": eventId },
                $push: { "pendingEvents": eventId }
            }
        )

        eventCollection.updateOne(
            { "_id": eventId },
            { $pull: { "rejecters": userId } }
        )

        res.send(successJson(eventId))
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
        res.send(successJson("OK"))
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

    /**
     * Uploads a story to a given event and sends socket notif to attendees
     */
    app.post('/uploadStory', bp.json(), (req, res) => {
        const eventId = new ObjectId(req.body.event);
        const userId = new ObjectId(req.body.user);
        const imageUrl = req.body.image;
        eventCollection.findOneAndUpdate(
            { "_id": eventId },
            {
                $push: {
                    storyImages: {
                        _id: new ObjectId(),
                        image: imageUrl,
                        poster: userId,
                        datePosted: new Date(),
                        viewers: [],
                    }
                }
            }
        )
            .then(response => {
                const origEventDoc = response.value
                const isExisting = origEventDoc.storyImages ? true : false
                for (const attendeeId of origEventDoc.attendees) {
                    if (isExisting)
                        handler.sendDataEvent(attendeeId.toString(), req.body.event, "existingStoryUpdate")
                    else {
                        console.log(attendeeId.toString())
                        handler.sendUserEvent(attendeeId.toString(), "newStoryUpdate")
                    }
                }
            })
        res.send(imageUrl)
    })

    app.post('/viewStoryImage', bp.json(), (req, res) => {
        const userId = new ObjectId(req.body.user);
        const eventId = new ObjectId(req.body.event);
        const imageId = new ObjectId(req.body.image);

        eventCollection.updateOne(
            { "_id": eventId, "storyImages._id": imageId },
            { $push: { "storyImages.$.viewers": userId } }
        )

        res.send(successJson("OK"));
    })

    app.post('/updateEvent/', bp.json(), (req, res) => {
        const eventId = new ObjectId(req.body.id);
        const creator = new ObjectId(req.body.creator);
        const isPublic = req.body.public;
        let updatedEvent = {}

        const optionalFields = ["image", "title", "description", "location", "tags", "other"]

        for (const field of optionalFields) {
            let fieldVal = req.body[field]
            // Set updated event field if present
            if (fieldVal) {
                if (field === "tags")
                    fieldVal = fieldVal.split("|")
                updatedEvent[field] = fieldVal
            }
        }

        if (req.body.startDate) {
            updatedEvent["startDate"] = new Date(req.body.startDate);
        }
        if (req.body.endDate) {
            updatedEvent["endDate"] = new Date(req.body.endDate)
        }
        if (isPublic) {
            updatedEvent["isPublic"] = isPublic
        }

        eventCollection.updateOne(
            { "_id": eventId },
            {
                $set: {
                    ...updatedEvent
                }
            });
        res.send(eventId)
    })

    app.post("/report", bp.json(), (req, res) => {
        const eventId = new ObjectId(req.body.event);
        const userId = new ObjectId(req.body.user);
        const reason = req.body.reason;
        let report = {
            "_id": new ObjectId(),
            "user": userId,
            "message": reason,
            "time": new Date()
        }

        if (req.body.story)
            report.story = new ObjectId(req.body.story);

        eventCollection.updateOne(
            { "_id": eventId },
            { $push: { "reports": report } }
        )
        res.send(successJson("OK"))
    })

    app.post("/deleteReport", bp.json(), (req, res) => {
        const eventId = new ObjectId(req.body.event);
        const reportId = new ObjectId(req.body.report);
        eventCollection.updateOne(
            { "_id": eventId },
            { $pull: { "reports": { "_id": reportId } } }
        )
        res.send(successJson("OK"))
    })

    app.post("/blockUser", bp.json(), (req, res) => {
        const userId = new ObjectId(req.body.user);
        const blockedUserId = new ObjectId(req.body.blockedUser);
        const isBlocking = req.body.isBlocking;
        if (isBlocking) {
            userCollection.updateOne(
                { "_id": userId },
                {
                    $push: { "blockedUsers": blockedUserId },
                    $pull: { "friends": blockedUserId, "friendRecommendations": blockedUserId }
                },
            )

            userCollection.updateOne(
                { "_id": blockedUserId },
                {
                    $push: { "blockedBy": userId },
                    $pull: { "friends": userId }
                }
            )
        } else {
            userCollection.updateOne(
                { "_id": userId },
                {
                    $pull: { "blockedUsers": blockedUserId },
                },
            )

            userCollection.updateOne(
                { "_id": blockedUserId },
                {
                    $pull: { "blockedBy": userId }
                },
            )
        }
        res.send(successJson("OK"))
    })

    app.post('/deleteAccount', bp.json(), () => {
        const userId = new ObjectId(req.body.user);
        userCollection.deleteOne({ "_id": userId })
        res.send(successJson("OK"))
    })

    app.post('/ingestEvents', bp.json(), async (req, res) => {
        const keyTopics = [
            "music",
            "sports",
            "art",
            "food",
            "movies",
            "theatre",
            "comedy",
            "dance",
            "literature",
            "computer science",
            "engineering",
            "history",
            "geography",
            "math",
            "research",
            "party",
        ]

        const results = []
        let ingested = new Set()

        for (const topic of keyTopics) {
            const res = await fetch(`https://events.cornell.edu/api/2/events/search?search=${topic}&experience=inperson&distinct=true&pp=100&sort=date&days=365`)
            const json = await res.json()
            for (const obj of json.events) {
                const event = obj.event

                if (!event.geo.latitude || ingested.has(event.title)) continue
                ingested.add(event.title)

                const mongoData = {
                    "creator": "62d23ebb09a8dd6c1fda7b3b",
                    "image": event.photo_url,
                    "title": event.title,
                    "startDate": event.event_instances[0].event_instance.start,
                    "endDate": event.event_instances[0].event_instance.end ? event.event_instances[0].event_instance.end : event.event_instances[0].event_instance.start,
                    "location": event.location_name === "" ? (event.address === "" ? "Cornell University" : event.address) : event.location_name,
                    "latitude": event.geo.latitude,
                    "longitude": event.geo.longitude,
                    "description": event.description_text,
                    "tags": [...event.tags, topic].join("|"),
                    "other": "",
                    "public": true,
                }

                results.push(mongoData)
                fetch("http://yolo-backend.herokuapp.com/create", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(mongoData)
                })
            }
        }

        res.send(successJson(results))
    })

    // Error handling middleware
    app.use((err, req, res, next) => {
        console.error(err.stack)
        res.status(500).send('Internal Server Error')
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
}