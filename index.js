require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf-8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// 1. Verify JWT Token
const verifyToken = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// MongoDB Connection String
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ydmo1rd.mongodb.net/?appName=Cluster0`;

// MongoDB Connection
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("bloodlineDB");
    const usersCollection = db.collection("users");
    const requestsCollection = db.collection("donationRequests");
    const districtsCollection = db.collection("districts");
    const upazilasCollection = db.collection("upazilas");

    // LOCATION API (Public)
    // Get All Districts
    app.get("/districts", async (req, res) => {
      const result = await districtsCollection.find().toArray();
      res.send(result);
    });

    // Get All Upazilas
    app.get("/upazilas", async (req, res) => {
      const result = await upazilasCollection.find().toArray();
      res.send(result);
    });

    // 2. Verify Admin Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden Access! Admins Only." });
      }
      next();
    };

    // 3. Verify Volunteer Middleware
    const verifyVolunteer = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "volunteer" && user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden Access! Volunteers Only." });
      }
      next();
    };

    // USER API
    // Save User Data
    // Checks if user exists; if not, saves with default role 'donor'
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      // Default fields for new registration
      const newUser = {
        ...user,
        role: "donor",
        status: "active",
        timestamp: new Date(),
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // Get Current User Role
    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // DONATION REQUEST API
    // Create Donation Request
    app.post("/donation-request", verifyToken, async (req, res) => {
      const request = req.body;

      // check user status is active
      const requester = await usersCollection.findOne({
        email: req.user.email,
      });
      if (requester.status === "blocked") {
        return res
          .status(403)
          .send({ message: "Blocked users cannot create requests" });
      }

      const newRequest = {
        ...request,
        status: "pending",
      };
      const result = await requestsCollection.insertOne(newRequest);
      res.send(result);
    });

    // Get All Pending Requests
    app.get("/donation-requests", async (req, res) => {
      const result = await requestsCollection
        .find({ status: "pending" })
        .toArray();
      res.send(result);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("BloodLine Server is Running...");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
