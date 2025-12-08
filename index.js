require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require("stripe")(stripeKey) : null;

if (!stripeKey) {
  console.warn(
    "WARNING: STRIPE_SECRET_KEY is missing. Payment features will not work."
  );
}

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
    const blogsCollection = db.collection("blogs");
    const paymentsCollection = db.collection("payments");

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

    // PUBLIC SEARCH API
    app.get("/search-donors", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      let query = {
        // role: "donor",
        status: "active",
      };

      if (bloodGroup) query.bloodGroup = bloodGroup;
      if (district) query.district = district;
      if (upazila) query.upazila = upazila;

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // PUBLIC DONATION REQUESTS API
    // Get all pending requests for public view
    app.get("/donation-requests", async (req, res) => {
      const result = await requestsCollection
        .find({ status: "pending" })
        .toArray();
      res.send(result);
    });

    // Admin APIs
    // 1. Admin Statistics (Home Page) - Allowed for Volunteer also
    app.get("/admin-stats", verifyToken, verifyVolunteer, async (req, res) => {
      const totalUsers = await usersCollection.estimatedDocumentCount();
      const totalRequests = await requestsCollection.estimatedDocumentCount();
      // Calculate Total Funds
      const result = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalAmount: { $sum: "$amount" },
            },
          },
        ])
        .toArray();
      const totalFunds = result.length > 0 ? result[0].totalAmount : 0;

      res.send({
        totalUsers,
        totalRequests,
        totalFunds,
      });
    });

    // 2. Get All Users
    app.get("/all-users", verifyToken, verifyAdmin, async (req, res) => {
      const { status } = req.query;
      let query = {};
      if (status) {
        query.status = status;
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // 3. Update User Status
    app.patch(
      "/users/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status: status },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // 4. Update User Role
    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { role: role },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // 5. Get All Donation Requests
    app.get(
      "/all-donation-requests",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status;

        const result = await requestsCollection.find(query).toArray();
        res.send(result);
      }
    );

    // BLOG / CONTENT MANAGEMENT API
    // 1. Create Blog (Admin Only)
    app.post("/blogs", verifyToken, verifyAdmin, async (req, res) => {
      const blog = req.body;
      const newBlog = {
        ...blog,
        status: "draft", // Default status
        createdAt: new Date(),
      };
      const result = await blogsCollection.insertOne(newBlog);
      res.send(result);
    });

    // 2. Get All Blogs (With filtering)
    // - Public: ?status=published
    // - Admin: All blogs
    app.get("/blogs", async (req, res) => {
      const { status } = req.query;
      let query = {};
      if (status) {
        query.status = status;
      }
      const result = await blogsCollection.find(query).toArray();
      res.send(result);
    });

    // 2.1 Get Single Blog (Public)
    app.get("/blogs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.findOne(query);
      res.send(result);
    });

    // 3. Update Blog Status (Publish/Unpublish) - Admin Only
    app.patch(
      "/blogs/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status: status },
        };
        const result = await blogsCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // 4. Delete Blog - Admin Only
    app.delete("/blogs/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.deleteOne(query);
      res.send(result);
    });

    // PAYMENT API
    // 1. Create Checkout Session
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      if (!stripe) {
        return res
          .status(500)
          .send({ message: "Stripe is not configured on the server." });
      }
      const { amount, donorName, donorEmail } = req.body;
      const amountInCents = parseInt(amount * 100);

      // Create a checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: donorEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Funding Donation",
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${
          process.env.CLIENT_URL || "http://localhost:5173"
        }/funding?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${
          process.env.CLIENT_URL || "http://localhost:5173"
        }/funding`,
        metadata: {
          donorName,
          donorEmail,
          amount,
        },
      });

      res.send({ url: session.url });
    });

    // 2. Verify & Save Payment from Session
    app.post("/payments/save-session", verifyToken, async (req, res) => {
      const { sessionId } = req.body;
      if (!stripe) {
        return res.status(500).send({ message: "Stripe error" });
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid") {
          // Check if payment already saved (using session ID as transaction ID check)
          const existing = await paymentsCollection.findOne({
            transactionId: sessionId,
          });
          if (existing) {
            return res.send({
              message: "Payment already saved",
              insertedId: null,
            });
          }

          const payment = {
            name: session.metadata.donorName,
            email: session.metadata.donorEmail,
            amount: parseFloat(session.metadata.amount),
            transactionId: sessionId,
            date: new Date(),
          };

          const result = await paymentsCollection.insertOne(payment);
          res.send(result);
        } else {
          res.status(400).send({ message: "Payment not paid" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error verifying payment" });
      }
    });

    // 3. Get All Funding (Verified Token)
    app.get("/funding", verifyToken, async (req, res) => {
      const result = await paymentsCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.send(result);
    });

    // ADMIN & VOLUNTEER SHARED API
    // Get All Requests (For Admin & Volunteer)
    app.get("/all-blood-donation-requests", verifyToken, async (req, res) => {
      // verify Volunteer Or Admin logic
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });

      if (user.role !== "admin" && user.role !== "volunteer") {
        return res.status(403).send({ message: "forbidden access" });
      }

      const { status } = req.query;
      let query = {};
      if (status) query.status = status;

      const result = await requestsCollection.find(query).toArray();
      res.send(result);
    });

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

    // User profile API
    // Get Single User Info
    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Update User Profile
    app.patch("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const updateDoc = {
        $set: {
          name: user.name,
          avatar: user.avatar,
          district: user.district,
          upazila: user.upazila,
          bloodGroup: user.bloodGroup,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // DONATION REQUEST API
    // Create Donation Request
    app.post("/donation-request", verifyToken, async (req, res) => {
      const request = req.body;
      const requesterEmail = req.user.email;

      // 1. Check if user is blocked
      const requester = await usersCollection.findOne({
        email: requesterEmail,
      });
      if (requester.status === "blocked") {
        return res
          .status(403)
          .send({ message: "Blocked users cannot create donation requests" });
      }

      // 2. Add Default Status
      const newRequest = {
        ...request,
        status: "pending", // Default status as per requirements
      };

      const result = await requestsCollection.insertOne(newRequest);
      res.send(result);
    });

    // Donation request management API
    // Get Requests filtered by Email
    app.get("/donation-requests/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { status } = req.query;

      // Verify the user is requesting their own data
      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      // Query
      let query = { requesterEmail: email };
      if (status) {
        query.status = status;
      }

      const result = await requestsCollection.find(query).toArray();
      res.send(result);
    });

    // Delete Donation Request
    app.delete("/donation-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestsCollection.deleteOne(query);
      res.send(result);
    });

    // Update Request Status
    app.patch("/donation-request-status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status: status },
      };
      const result = await requestsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // 1. Get Single Request (For Details & Update Page)
    app.get("/donation-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestsCollection.findOne(query);
      res.send(result);
    });

    // 2. Update Request (Edit Content)
    app.put("/donation-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          recipientName: body.recipientName,
          recipientDistrict: body.recipientDistrict,
          recipientUpazila: body.recipientUpazila,
          hospitalName: body.hospitalName,
          fullAddress: body.fullAddress,
          bloodGroup: body.bloodGroup,
          donationDate: body.donationDate,
          donationTime: body.donationTime,
          requestMessage: body.requestMessage,
        },
      };
      const result = await requestsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // 3. Donate Action (Changes status to 'inprogress' & adds donor info)
    app.put("/donation-request/donate/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { donorName, donorEmail } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "inprogress",
          donorName: donorName,
          donorEmail: donorEmail,
        },
      };
      const result = await requestsCollection.updateOne(query, updateDoc);
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
