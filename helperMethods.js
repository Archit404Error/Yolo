/**
 * Calulates distance (mi) between two points in lat/long coords
 * Requires: all latitude and longitude values are valid
 * @param lat1 latitude of first point
 * @param lon1 longitude of first point
 * @param lat2 latitude of second point
 * @param lon2 longitude of second point
 * Implementation of Haversine formula
 */
export const pointDist = (lat1, lon1, lat2, lon2) => {
    const degToRad = Math.degToRadI / 180;
    const cos = Math.cos;
    const angle = 0.5 - cos((lat2 - lat1) * degToRad) / 2 +
        cos(lat1 * degToRad) * cos(lat2 * degToRad) *
        (1 - cos((lon2 - lon1) * degToRad)) / 2;

    return 7917.509282 * Math.asin(Math.sqrt(angle));
}

/**
 * Takes an array of notifications and sends them to users in batches (called chunks)
 * @param {NotifObject[]} notifs an array of notification objects
 * @param {Object} expoServer the server object to connect with
 */
const sendNotifChunks = async (notifs, expoServer) => {
    let chunks = expoServer.chunkPushNotifications(notifs);
    let tickets = [];

    for (let chunk of chunks) {
        try {
            let ticketChunk = await expoServer.sendPushNotificationsAsync(chunk);
            // store tickets to check for notif status later
            tickets.push(...ticketChunk);
        } catch (err) {
            console.log("Error while sending notif chunk");
        }
        console.log(tickets);
    }
}

export const sendNotifs = (tokens, title, body, expoServer) => {
    try {
        let notifs = [];
        tokens.forEach(token => {
            notifs.push({
                to: token,
                sound: 'default',
                title: title,
                body: body,
            })
        })

        sendNotifChunks(notifs, expoServer)
    }
    // Simply do nothing if the user has no tokens
    catch (err) { console.log(err) }
}

/** 
 * Calculates hours in milliseconds
 * @param hours the amount of hours to be converted
 * Inteded use: for suggestion algorithm intervals
 */
export const hoursToMillis = hours => hours * 3600000

/** 
 * Calculates days in milliseconds
 * @param days the amount of days to be converted
 */
export const daysToMillis = days => hoursToMillis(days * 24)

export const successJson = data => {
    return {
        status: "success",
        data: data
    }
}

export const errorJson = data => {
    return {
        status: "error",
        data: data
    }
}

/** Event Suggestion functions start */

export const calculateTagWeights = userDoc => {
    let acceptedEventWeights = {}
    userDoc.acceptedEvents.forEach(event =>
        event.tags.forEach(tag => {
            const weight = 1 / event.tags.length;
            const count = acceptedEventWeights[tag];
            acceptedEventWeights[tag] = count ? count + weight : weight;
        })
    )
    let tagWeights = Object.values(acceptedEventWeights);
    let totalSum = tagWeights.reduce((acc, elem) => acc + elem, 0);
    Object.keys(acceptedEventWeights).forEach(tag => {
        acceptedEventWeights[tag] /= totalSum;
    })
    return acceptedEventWeights
}

export const calculateOrganizerWeights = userDoc => {
    let organizerWeights = {}
    userDoc.acceptedEvents.forEach(event => {
        const count = organizerWeights[event.creator._id];
        organizerWeights[event.creator._id] = count ? count + 1 : 1;
    })
    Object.keys(organizerWeights).forEach(orgId => {
        organizerWeights[orgId] /= userDoc.acceptedEvents.length;
    })
    return organizerWeights
}


export const calculateAttendeeEventWeights = async (userDoc, userCollection) => {
    let attendeeEventWeights = {}
    for (let event of userDoc.acceptedEvents) {
        for (let attendee of event.attendees) {
            const attendeeDoc = await userCollection.findOne({ "_id": attendee })

            for (const attEvent of attendeeDoc.acceptedEvents) {
                if (attEvent && !userDoc.acceptedEvents.includes(attEvent) && !userDoc.pendingEvents.includes(attEvent._id) && !!userDoc.rejectedEvents.includes(attEvent._id)) {
                    let match = 0;
                    for (const tag of attEvent.tags)
                        match += event.tags.includes(tag)
                    if (match != 0) {
                        let similarity = match / event.tags.length;
                        attendeeEventWeights[attEvent._id] = similarity;
                    }
                }
            }
        }
    }

    return attendeeEventWeights
}


/** Event Suggestion functions end */