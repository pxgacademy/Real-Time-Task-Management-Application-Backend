require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
        const projects = await projectsCollection.findOne({ email });
        res.send(projects);
      } catch (error) {
        next(error);
      }
    });

    // insert a new project
    app.post("/projects/:userId", async (req, res, next) => {
      try {
        const { userId } = req.params;
        const { projectName, status } = req.body;

        // Check if the user exists
        const userProjects = await projectsCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!userProjects) {
          return res
            .status(404)
            .json({ success: false, message: "User not found!" });
        }

        // Generate a unique project ID based on timestamp
        const projectId = Date.now();

        // Create the new project object
        const newProject = {
          id: projectId, // Unique ID
          projectName: projectName || "Untitled Project",
          status: status || "In Progress",
          tasks: [],
        };

        // Add the new project to the user's project list
        const result = await projectsCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { project: newProject } }
        );

        if (result.modifiedCount > 0) {
          res.send({
            success: true,
            message: "Project added successfully!",
            project: newProject,
          });
        } else {
          res
            .status(500)
            .send({ success: false, message: "Failed to add project!" });
        }
      } catch (error) {
        next(error);
      }
    });

    // update a project
    app.patch(
      "/projects/:userId/project/:projectId",
      async (req, res, next) => {
        try {
          const { userId, projectId } = req.params;
          const { projectName, status } = req.body;

          // Check if user exists
          const userProjects = await projectsCollection.findOne({
            _id: new ObjectId(userId),
          });

          if (!userProjects) {
            return res
              .status(404)
              .json({ success: false, message: "User not found!" });
          }

          // Prepare the update object
          let updateFields = {};
          if (projectName)
            updateFields["project.$[proj].projectName"] = projectName;
          if (status) updateFields["project.$[proj].status"] = status;

          // Update the specific project in the array
          const result = await projectsCollection.updateOne(
            { _id: new ObjectId(userId), "project.id": parseInt(projectId) },
            { $set: updateFields },
            {
              arrayFilters: [{ "proj.id": parseInt(projectId) }],
            }
          );

          if (result.modifiedCount > 0) {
            res.json({
              success: true,
              message: "Project updated successfully!",
            });
          } else {
            res.status(404).json({
              success: false,
              message: "Project not found or no changes made!",
            });
          }
        } catch (error) {
          next(error);
        }
      }
    );

    // delete a project
    app.delete("/projects/:userId/:projectId", async (req, res, next) => {
      try {
        const { userId, projectId } = req.params;
        const projectIdNumber = parseInt(projectId); // Convert to number

        // Find the user document
        const userProjects = await projectsCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!userProjects) {
          return res
            .status(404)
            .send({ success: false, message: "User not found!" });
        }

        const projectList = userProjects.project || [];

        // Check if the project exists
        const projectExists = projectList.some(
          (proj) => proj.id === projectIdNumber
        );
        if (!projectExists) {
          return res
            .status(404)
            .send({ success: false, message: "Project not found!" });
        }

        // Remove the project with the specified ID
        const updatedProjects = projectList.filter(
          (proj) => proj.id !== projectIdNumber
        );

        // Update the database with the modified project list
        const result = await projectsCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { project: updatedProjects } }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Project deleted successfully!" });
        } else {
          res
            .status(500)
            .send({ success: false, message: "Failed to delete project!" });
        }
      } catch (error) {
        next(error);
      }
    });

    // insert a new task to a specific project
    app.post(
      "/projects/:projectId/projectIndex/:projectIndex/tasks",
      async (req, res, next) => {
        try {
          const { projectId, projectIndex } = req.params;
          const newTask = req.body;

          // Add an `index` to the new task based on existing tasks count
          const project = await projectsCollection.findOne({
            _id: new ObjectId(projectId),
            "project.index": parseInt(projectIndex),
          });

          if (!project) {
            return res
              .status(404)
              .json({ success: false, message: "Project not found!" });
          }

          const taskList =
            project.project.find((p) => p.index === parseInt(projectIndex))
              ?.tasks || [];
          newTask.index = taskList.length; // Set index as the next available number

          // Push new task to the project
          const result = await projectsCollection.updateOne(
            {
              _id: new ObjectId(projectId),
              "project.index": parseInt(projectIndex),
            },
            { $push: { "project.$[proj].tasks": newTask } },
            { arrayFilters: [{ "proj.index": parseInt(projectIndex) }] }
          );

          if (result.modifiedCount > 0) {
            res.json({
              success: true,
              message: "Task added successfully!",
              task: newTask,
            });
          } else {
            res
              .status(500)
              .json({ success: false, message: "Failed to add task!" });
          }
        } catch (error) {
          next(error);
        }
      }
    );

    // updates the task status in a specific project
    app.patch(
      "/projects/:userId/project/:projectId/task/:taskId",
      async (req, res, next) => {
        try {
          const { userId, projectId, taskId } = req.params;
          const update = req.body;

          const result = await projectsCollection.updateOne(
            {
              _id: new ObjectId(userId),
              "project.id": parseInt(projectId),
              "project.tasks.id": parseInt(taskId),
            },
            {
              $set: update,
            },
            {
              arrayFilters: [
                { "proj.id": parseInt(projectId) },
                { "task.id": parseInt(taskId) },
              ],
            }
          );

          if (result.modifiedCount > 0) {
            res.send({
              success: true,
              message: "Task status updated successfully!",
            });
          } else {
            res
              .status(404)
              .send({ success: false, message: "Task not found!" });
          }
        } catch (error) {
          next(error);
        }
      }
    );

    // delete a specific task from a project
    app.delete(
      "/projects/:projectId/projectIndex/:projectIndex/tasks/:taskIndex",
      async (req, res, next) => {
        try {
          const { projectId, projectIndex, taskIndex } = req.params;

          const result = await projectsCollection.updateOne(
            {
              _id: new ObjectId(projectId),
              "project.index": parseInt(projectIndex),
            },
            {
              $pull: {
                "project.$[proj].tasks": { index: parseInt(taskIndex) },
              },
            },
            { arrayFilters: [{ "proj.index": parseInt(projectIndex) }] }
          );

          if (result.modifiedCount > 0) {
            res.send({ success: true, message: "Task deleted successfully!" });
          } else {
            res
              .status(404)
              .send({ success: false, message: "Task not found!" });
          }
        } catch (error) {
          next(error);
        }
      }
    );
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
