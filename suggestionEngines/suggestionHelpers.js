/**
 * Gives a list of all user ids in the users collection
 * @param userCollection the collection to pull user data from
 * @returns an array of ObjectId(s)
 */
export const getAllUserIds = async (userCollection) => {
    return (
        await userCollection.aggregate([
            {
                $match: {}
            },
            {
                $project: {
                    "_id": 1
                }
            }
        ]).toArray()
    ).map(obj => obj._id);
}