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
    const friendCursor = userCollection.find({ "friends": { $all: [userId] } })
    const friendDocs = await friendCursor.toArray();
    const userDoc = await userCollection.findOne({ _id: userId });

    for (const friendDoc of await friendDocs) {
        friendDoc.friends.forEach(id => {
            if (!id.equals(userId)) {
                if (!userDoc.blockedUsers.some(e => e.equals(id))) {
                    // Compute weighted importance of connection (edge weight in friend graph)
                    const weight = 1 / friendDoc.friends.length;
                    if (acquaintanceOccurrences[id])
                        acquaintanceOccurrences[id] += weight;
                    else
                        acquaintanceOccurrences[id] = weight;
                }
            }
        })
    }

    const pastEventDetails = userDoc.acceptedEvents
    for (const eventDoc of pastEventDetails) {
        eventDoc.attendees.forEach(id => {
            if (!id.equals(userId)) {
                if (!userDoc.blockedUsers.some(e => e.equals(id))) {
                    // Compute weight based on number of attendees of event
                    const weight = 1 / eventDoc.attendees.length;
                    if (acquaintanceOccurrences[id])
                        acquaintanceOccurrences[id] += weight;
                    else
                        acquaintanceOccurrences[id] = weight;
                }
            }
        })
    }

    console.log(JSON.stringify(acquaintanceOccurrences))

    // Store top 20 most occurring acquaintances and remove existing friends
    let topRec = Object.entries(acquaintanceOccurrences)
        .sort(([, a], [, b]) => a - b)
        .map(freqArr => new ObjectId(freqArr[0]))
        .filter(id => !userDoc.friends.some(e => e.equals(id)))
        .filter((_, index) => index < 20)

    if (topRec.length === 0) {
        topRec = await userCollection.aggregate([
            {
                $match: {
                    "friends": {
                        $not: {
                            $all: [new ObjectId(userId)]
                        }
                    }
                }
            },
            {
                $project: {
                    "_id": 1,
                }
            },
            {
                $limit: 5
            }
        ])
            .toArray()
        topRec = topRec.map(data => data._id)
    }

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