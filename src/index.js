const { ApolloServer, gql } = require("apollo-server");
const mysql = require("mysql");

/* 

PHPMyAdmin Details:
Username - sql5432499
Password - Lp5Tw8l2GR

host: sql5.freesqldatabase.com
database: sql5432499

*/

const connection = mysql.createConnection({
  host: "sql5.freesqldatabase.com",
  user: "sql5432499",
  password: "Lp5Tw8l2GR",
  database: "sql5432499",
});

connection.connect((err) => {
  if (err) throw err;
  console.log("🚀  MySQL Connection Established");
});

function getAllEvents(id) {
  return new Promise((resolve, reject) => {
    if (id != "")
      var query = "SELECT * FROM Events WHERE id = " + id;
    else
      var query = "SELECT * FROM Events";
    connection.query(query, (err, rows) => {
      if (err)
        return reject(err);
      resolve(rows);
    });
  });
}

const typeDefs = gql`
  type Event {
    id: Int!
    image: String!
    title: String!
    description: String!
    location: String!
    other: String
  }
  type Query {
    events(id: String, q: String): [Event]
  }
  type Mutation {
    updateEvent(
      id: Int!
      image: String
      title: String
      description: String
      location: String
      other: String
    ): Event
    addEvent(
      id: Int!
      image: String!
      title: String!
      description: String!
      location: String!
      other: String
    ): Event
    deleteEvent(id: String, title: String!): Event
  }
`;

const resolvers = {
  Query: {
    async events(parent, args, ctx, info) {
      if (args.id) {
        const res = await getAllEvents(args.id)
        .then(rows => {return JSON.parse(JSON.stringify(rows))})
        .catch(err => setImmediate(() => {throw err}))
        return res;
      } else {
        const res = await getAllEvents("")
        .then(rows => {return JSON.parse(JSON.stringify(rows));})
        .catch(err => setImmediate(() => {throw err;}))
        return res;
      }
    },
  },
  Mutation: {
    addEvent(parent, args, ctx, info) {
      var extra = "";
      if (args.other) {
        extra = args.other;
      }
      var sql =
        `INSERT into Events(id, image, title, description, location, other)` +
        ` VALUES("${args.id}", "${args.image}", "${args.title}", "${args.description}", "${args.location}", "${extra}");`;
      // console.log(sql);
      connection.query(sql, (err, res) => {
        if (err) throw err;
        console.log("Inserted vals");
      });
    },
    updateEvent(parent, args, ctx, info) {
      var changeVals =
        `UPDATE Events SET ` +
        `image = "${args.image}", ` +
        `title = "${args.title}", ` +
        `description = "${args.description}", ` +
        `location = "${args.location}", ` +
        `other = "${args.other}", ` +
        `WHERE id = "${args.id}";`;
      connection.query(changeVals, (err, res) => {
        if (err) throw err;
        console.log("Edited");
      });
    },
    deleteEvent(parent, args, ctx, info) {
      var delVal = `DELETE FROM Events WHERE title = "${args.title}"`;
      connection.query(delVal, (err, res) => {
        if (err) throw err;
      });
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });

server.listen({ port: process.env.PORT || 4000 }).then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
