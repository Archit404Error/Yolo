import { ObjectId } from "mongodb";
import { calculateTagWeights, calculateOrganizerWeights, calculateAttendeeEventWeights } from "../helperMethods.js";
import { getAllUserIds } from "./suggestionHelpers.js";

export const populateEventSuggestions = async (userCollection, eventCollection, userId) => {
    const userDoc = await userCollection.findOne({ "_id": userId });
    let tagWeights = {};
    let organizerWeights = {};
    let attendeeEventWeights = {};

    // Find most accepted tags
    tagWeights = calculateTagWeights(userDoc)
    console.log("calculated tag")

    // Find most accepted organizers
    organizerWeights = calculateOrganizerWeights(userDoc)
    console.log("calculated org")

    // Find most similar attended events by people who attended this event
    // let finalWeights = await calculateAttendeeEventWeights(await userDoc, userCollection)
    let finalWeights = {}

    const potential = await eventCollection.find({
        _id: {
            $nin: ([
                await userDoc.acceptedEvents.map(event => event._id),
                await userDoc.pendingEvents,
                await userDoc.rejectedEvents
            ].flat())
        },
        endDate: {
            $gte: new Date()
        },
    }).toArray()

    potential.forEach(event => {
        let score = 1;
        if (event.creator._id in organizerWeights)
            score += organizerWeights[event.creator._id]
        for (const tag of event.tags) {
            if (tag in tagWeights)
                score += tagWeights.tag;
        }

        finalWeights[event._id] = score
    })

    // Store top 20 most occurring events
    const topRec = Object.entries(finalWeights)
        .sort(([, a], [, b]) => a - b)
        .map(freqArr => freqArr[0])
        .filter((_, index) => index < 20)
        .map(rec => new ObjectId(rec))

    userCollection.updateOne(
        { "_id": new ObjectId(userId) },
        { $push: { "pendingEvents": { $each: topRec } } }
    )

    return topRec
}

export const populateAllEventSuggestions = async (userCollection, eventCollection) => {
    console.log("populating...")
    const users = await getAllUserIds(userCollection);

    for (const user of await users)
        populateEventSuggestions(userCollection, eventCollection, user)
}