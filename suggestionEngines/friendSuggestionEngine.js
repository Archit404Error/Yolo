import { ObjectId } from 'mongodb';
import { getAllUserIds } from './suggestionHelpers.js';

/**
 * An endpoint to populate user friend suggestions
 * @param userCollection the users collection to pull data from
 * @param {ObjectId} userId the id of the user to populate friends for
 * @returns top 5 best friend suggestions for the given uesr
 */
export const populateFriends = async (userCollection, userId) => {
    let acquaintanceOccurrences = {};
    let userFriends = new Set();
    const friendCursor = userCollection.find({ "friends": { $all: [userId] } })
    const friendDocs = await friendCursor.toArray();

    for (const friendDoc of await friendDocs) {
        userFriends.add(friendDoc._id);
        friendDoc.friends.forEach(id => {
            if (!id.equals(userId)) {
                // Compute weighted importance of connection (edge weight in friend graph)
                const weight = 1 / friendDoc.friends.length;
                if (acquaintanceOccurrences[id])
                    acquaintanceOccurrences[id] += weight;
                else
                    acquaintanceOccurrences[id] = weight;
            }
        })
    }

    userCollection.findOne({ "_id": new ObjectId(userId) }, (_, res) => {
        const pastEventDetails = res.acceptedEvents
        for (const eventDoc of pastEventDetails) {
            eventDoc.attendees.forEach(id => {
                if (!id.equals(userId)) {
                    // Compute weight based on number of attendees of event
                    const weight = 1 / eventDoc.attendees.length;
                    if (acquaintanceOccurrences[id])
                        acquaintanceOccurrences[id] += weight;
                    else
                        acquaintanceOccurrences[id] = weight;
                }
            })
        }
    })

    console.log(userFriends)
    console.log(acquaintanceOccurrences)

    // Store top 5 most occurring acquaintances and remove existing friends
    const topRec = Object.entries(acquaintanceOccurrences)
        .sort(([, a], [, b]) => a - b)
        .map(freqArr => new ObjectId(freqArr[0]))
        .filter(id => !userFriends.has(id))
        .filter((_, index) => index < 5)

    console.log(topRec)

    userCollection.updateOne(
        { "_id": new ObjectId(userId) },
        { $set: { "friendRecommendations": topRec } }
    )

    return topRec
}

/**
 * Populates friend suggestions for every user in the DB
 * @param userCollection the collection to pull users from
 */
export const populateAllFriends = async (userCollection) => {
    console.log("populating...")
    const users = await getAllUserIds(userCollection)

    for (const user of await users)
        populateFriends(userCollection, user)
}