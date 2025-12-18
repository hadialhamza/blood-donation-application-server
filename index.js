require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require("stripe")(stripeKey) : null;

const app = express();

// 🔌 ------------------ CONFIGURATION & MIDDLEWARE ------------------ 🔌
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf-8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

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

// 🚀 ------------------ MONGODB CONNECTION ------------------ 🚀
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ydmo1rd.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // 🗄️ ------------------ DB COLLECTIONS ------------------ 🗄️
    const db = client.db("bloodlineDB");
    const usersCollection = db.collection("users");
    const requestsCollection = db.collection("donationRequests");
    const blogsCollection = db.collection("blogs");
    const paymentsCollection = db.collection("payments");

    // 🛡️ ------------------ SECURITY MIDDLEWARES ------------------ 🛡️
    // Admin Middleware
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

    // Volunteer Middleware
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

    // 🩸 ------------------ BLOOD DONATION OPERATIONS APIS ------------------ 🩸
    // Create Donation Request
    app.post("/donation-request", verifyToken, async (req, res) => {
      const request = req.body;
      const requesterEmail = req.user.email;

      const requester = await usersCollection.findOne({
        email: requesterEmail,
      });
      if (requester.status === "blocked") {
        return res
          .status(403)
          .send({ message: "Blocked users cannot create donation requests" });
      }

      const newRequest = { ...request, status: "pending" };
      const result = await requestsCollection.insertOne(newRequest);
      res.send(result);
    });

    // Get Donation Requests
    app.get("/donation-requests/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { status } = req.query;

      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      let query = { requesterEmail: email };
      if (status) query.status = status;

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

    // Update Donation Request
    app.patch("/donation-request-status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: status } };
      const result = await requestsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Get Donation Request
    app.get("/donation-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestsCollection.findOne(query);
      res.send(result);
    });

    // Update Donation Request
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

    // Update Donation Request
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

    // 🌍 ------------------ PUBLIC ROUTES ------------------ 🌍
    // Donor search
    app.get("/search-donors", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      let query = { status: "active" };

      if (bloodGroup) query.bloodGroup = bloodGroup;
      if (district) query.district = district;
      if (upazila) query.upazila = upazila;

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Get all pending requests
    app.get("/donation-requests", async (req, res) => {
      const result = await requestsCollection
        .find({ status: "pending" })
        .toArray();
      res.send(result);
    });

    // ⚡ ------------------ ADMIN MANAGEMENT RELATED APIS ------------------ ⚡
    // Get all users
    app.get("/all-users", verifyToken, verifyAdmin, async (req, res) => {
      const { status } = req.query;
      let query = {};
      if (status) query.status = status;
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Update user status
    app.patch(
      "/users/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: status } };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // Update user role
    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role: role } };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Get all donation requests
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

    // 🤝 ------------------ SHARED ROLE ACCESS ------------------ 🤝
    // All Blood Donation Requests
    app.get("/all-blood-donation-requests", verifyToken, async (req, res) => {
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

    // 👤 ------------------ USER ACCOUNT & PROFILE RELATED APIS ------------------ 👤
    // Add User
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      const newUser = {
        ...user,
        role: "donor",
        status: "active",
        timestamp: new Date(),
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // Get User
    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // Get User Stats
    app.get("/user-stats/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      // Donor Stats
      const donorStats = await requestsCollection
        .find({ donorEmail: email, status: "done" })
        .toArray();
      const donations = donorStats.length;

      // Requester Stats
      const requesterStats = await requestsCollection
        .find({ requesterEmail: email })
        .toArray();
      const requests = requesterStats.length;
      const activeRequests = requesterStats.filter(
        (r) => r.status === "pending" || r.status === "inprogress"
      ).length;

      // This Month Donations
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const thisMonthDonations = donorStats.filter((d) => {
        const date = new Date(d.donationDate);
        return (
          !isNaN(date) &&
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        );
      }).length;

      res.send({
        donations,
        requests,
        activeRequests,
        thisMonth: thisMonthDonations,
        successRate: donations > 0 ? 100 : 0,
        level: donations > 10 ? "Gold" : donations > 5 ? "Silver" : "Bronze",
        helped: donations,
        avgResponseTime: 2,
      });
    });

    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Update User
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
          phone: user.phone,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // 📰 ------------------ CONTENT MANAGEMENT RELATED APIS ------------------ 📰
    // Create a new blog
    app.post("/blogs", verifyToken, verifyAdmin, async (req, res) => {
      const blog = req.body;
      const newBlog = { ...blog, status: "draft", createdAt: new Date() };
      const result = await blogsCollection.insertOne(newBlog);
      res.send(result);
    });

    // Get all blogs
    app.get("/blogs", async (req, res) => {
      const { status } = req.query;
      let query = {};
      if (status) query.status = status;
      const result = await blogsCollection.find(query).toArray();
      res.send(result);
    });

    // Get a single blog
    app.get("/blogs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.findOne(query);
      res.send(result);
    });

    // Update blog status
    app.patch(
      "/blogs/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: status } };
        const result = await blogsCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // Delete blog
    app.delete("/blogs/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.deleteOne(query);
      res.send(result);
    });

    // 💳 ------------------ PAYMENTS & FUNDING RELATED APIS ------------------ 💳
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      if (!stripe)
        return res
          .status(500)
          .send({ message: "Stripe is not configured on the server." });

      const { amount, donorName, donorEmail } = req.body;
      const amountInCents = parseInt(amount * 100);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: donorEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Funding Donation" },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${
          process.env.CLIENT_URL ||
          req.headers.origin ||
          "http://localhost:5173"
        }/funding?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${
          process.env.CLIENT_URL ||
          req.headers.origin ||
          "http://localhost:5173"
        }/funding`,
        metadata: { donorName, donorEmail, amount },
      });

      res.send({ url: session.url });
    });

    app.post("/payments/save-session", verifyToken, async (req, res) => {
      const { sessionId } = req.body;
      if (!stripe) return res.status(500).send({ message: "Stripe error" });

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid") {
          const existing = await paymentsCollection.findOne({
            transactionId: sessionId,
          });
          if (existing)
            return res.send({
              message: "Payment already saved",
              insertedId: null,
            });

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

    app.get("/funding", verifyToken, async (req, res) => {
      const result = await paymentsCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.send(result);
    });

    // 📊 ------------------ DASHBOARD ANALYTICS ------------------ 📊
    app.get("/admin-stats", verifyToken, verifyVolunteer, async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const bloodRequests = await requestsCollection.estimatedDocumentCount();

      // Calculate total revenue
      const payments = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
              totalDonations: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const revenue = payments.length > 0 ? payments[0].totalRevenue : 0;
      const totalDonations =
        payments.length > 0 ? payments[0].totalDonations : 0;

      // Aggregation for chart
      const monthlyStats = await requestsCollection
        .aggregate([
          { $match: {} },
          {
            $project: {
              month: {
                $month: {
                  $convert: {
                    input: "$donationDate",
                    to: "date",
                    onError: new Date(),
                    onNull: new Date(),
                  },
                },
              },
              year: {
                $year: {
                  $convert: {
                    input: "$donationDate",
                    to: "date",
                    onError: new Date(),
                    onNull: new Date(),
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: { month: "$month", year: "$year" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ])
        .toArray();

      // Pie Chart Data
      const statusStats = await requestsCollection
        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray();

      // Bar Chart Data
      const userStats = await usersCollection
        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray();

      res.send({
        users,
        bloodRequests,
        revenue,
        totalDonations,
        statusStats,
        userStats,
      });
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
