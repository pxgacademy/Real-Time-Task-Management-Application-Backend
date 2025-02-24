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

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rm6ii.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// const uri = "mongodb://localhost:27017";
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
    if (!token) return res.status(401).send({ message: "Unauthorized access" });

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) return res.status(401).send({ message: "Unauthorized access" });
      req.user = decoded;
      next();
    });
  } catch (error) {
    next(error);
  }
};

async function run() {
  try {
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
        res.cookie("token", token, cookieOptions).send({ success: true });
      } catch (error) {
        next(error);
      }
    });

    app.delete("/logout", (req, res, next) => {
      try {
        res.clearCookie("token", cookieOptions).send({ success: true });
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
          return res.status(409).send({ message: "Email already exists" });
        }
        const result = await userCollection.insertOne(newUser);
        await projectsCollection.insertOne({
          email: newUser.email,
          project: [],
        });
        res.status(201).send(result);
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
            .send({ success: false, message: "User not found!" });
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
              .send({ success: false, message: "User not found!" });
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
            res.send({
              success: true,
              message: "Project updated successfully!",
            });
          } else {
            res.status(404).send({
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
      "/projects/:userId/project/:projectId/tasks",
      async (req, res, next) => {
        try {
          const { userId, projectId } = req.params;
          let newTask = req.body;

          // Generate a unique ID based on the current timestamp
          newTask.id = Date.now();

          // Find the user and the project by filtering with project ID
          const userProjects = await projectsCollection.findOne({
            _id: new ObjectId(userId),
          });

          if (!userProjects) {
            return res
              .status(404)
              .send({ success: false, message: "User not found!" });
          }

          const projectExists = userProjects.project.some(
            (p) => p.id.toString() === projectId
          );
          if (!projectExists) {
            return res
              .status(404)
              .send({ success: false, message: "Project not found!" });
          }

          // Push new task to the project's task array
          const result = await projectsCollection.updateOne(
            { _id: new ObjectId(userId), "project.id": Number(projectId) },
            { $push: { "project.$.tasks": newTask } }
          );

          if (result.modifiedCount > 0) {
            res.send({
              success: true,
              message: "Task added successfully!",
              task: newTask,
            });
          } else {
            res
              .status(500)
              .send({ success: false, message: "Failed to add task!" });
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

    // delete a specific task from project
    app.delete(
      "/projects/:userId/project/:projectId/tasks/:taskId",
      async (req, res, next) => {
        try {
          const { userId } = req.params;
          const projectId = Number(req.params.projectId); // Convert to number
          const taskId = Number(req.params.taskId); // Convert to number

          // Find the user document
          const user = await projectsCollection.findOne({
            _id: new ObjectId(userId),
          });

          if (!user) {
            return res
              .status(404)
              .send({ success: false, message: "User not found!" });
          }

          // Check if the project exists
          const projectExists = user.project.some(
            (proj) => proj.id === projectId
          );

          if (!projectExists) {
            return res
              .status(404)
              .send({ success: false, message: "Project not found!" });
          }

          // Remove the task from the specified project
          const result = await projectsCollection.updateOne(
            {
              _id: new ObjectId(userId),
              "project.id": projectId,
            },
            {
              $pull: {
                "project.$[proj].tasks": { id: taskId },
              },
            },
            { arrayFilters: [{ "proj.id": projectId }] }
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

    // await client.connect();
    // console.log("Connected to MongoDB successfully!");
  } catch (error) {
    // console.log("MongoDB Connection Error:", error);
  }
}

run();

app.get("/", (req, res) => {
  res.status(200).send("Task Management Server is running");
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  res
    .status(500)
    .send({ message: "Internal Server Error", error: err.message });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
