require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://task-management-app-d6f4c.web.app",
      "https://task-management-app-d6f4c.firebaseapp.com",
    ],
    credentials: true,
  })
);

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rm6ii.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: "Unauthorized access" });

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) return res.status(401).json({ message: "Unauthorized access" });
      req.user = decoded;
      next();
    });
  } catch (error) {
    next(error);
  }
};

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB successfully!");

    const db = client.db("TaskManagementApp");
    const userCollection = db.collection("users");
    const projectsCollection = db.collection("projects");

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    };

    // Authentication Routes
    app.post("/jwt", (req, res, next) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "23h",
        });
        res.cookie("token", token, cookieOptions).json({ success: true });
      } catch (error) {
        next(error);
      }
    });

    app.delete("/logout", (req, res, next) => {
      try {
        res.clearCookie("token", cookieOptions).json({ success: true });
      } catch (error) {
        next(error);
      }
    });

    // User Routes
    app.post("/users", async (req, res, next) => {
      try {
        const newUser = req.body;
        const existingUser = await userCollection.findOne({
          email: newUser.email,
        });
        if (existingUser) {
          return res.status(409).json({ message: "Email already exists" });
        }
        const result = await userCollection.insertOne(newUser);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });

    // Project Routes
    app.get("/projects/:email", async (req, res, next) => {
      try {
        const email = req.params.email;
        const projects = await projectsCollection.find({ email }).toArray();
        res.json(projects);
      } catch (error) {
        next(error);
      }
    });
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run();

app.get("/", (req, res) => {
  res.status(200).send("Task Management Server is running");
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .json({ message: "Internal Server Error", error: err.message });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
