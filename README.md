# 🍜 50-50 Chinese Fast Food

**50-50 Chinese Fast Food** is a modern web-based restaurant ordering and table-management platform built for a Chinese fast-food business.

The application provides customers with an online menu, food ordering functionality, cart management, and table-based ordering. The system uses a separate frontend and backend architecture with the frontend deployed on **Vercel**, the backend deployed on **Render**, and **MongoDB** used as the production database.

🔗 **GitHub Repository:** https://github.com/Kunal-debug1/50-50-Chinese-Fast-Food

---

# 📌 Project Overview

The platform was developed to provide a digital ordering experience for **50-50 Chinese Fast Food**.

Customers can browse the restaurant menu, select food items, add items to their cart, and place orders through the web application.

The application is designed with a separate frontend and backend, allowing the two layers to be developed, deployed, and maintained independently.

---

# ✨ Key Features

## 🍜 Digital Menu

Customers can browse available food items through an online menu.

Menu information can include:

* Food name
* Description
* Price
* Category
* Food image
* Availability

---

## 🛒 Shopping Cart

Customers can:

* Add food items to the cart
* Increase or decrease quantities
* Remove items
* View cart totals
* Review their order before placing it

---

## 🪑 Table-Based Ordering

The application supports restaurant table-based ordering.

A table-specific URL can be used to identify the customer's table.

Example:

```text
/tables/<table-number>
```

This allows customers sitting at a particular restaurant table to access the ordering interface associated with that table.

---

## 📦 Order Management

The backend handles order-related operations such as:

* Creating orders
* Storing order information
* Associating orders with tables
* Storing ordered items
* Calculating order totals
* Retrieving order information

---

## 📱 Responsive Interface

The frontend is designed to work across:

* Desktop
* Laptop
* Tablet
* Mobile devices

This is particularly useful for customers accessing the menu through their smartphones while sitting in the restaurant.

---

# 🏗️ System Architecture

The application follows a modern full-stack architecture.

```text
                         Customer
                            │
                            ▼
                    React Web Application
                            │
                            │
                     Vercel Deployment
                            │
                            │ API Requests
                            ▼
                     Backend API
                            │
                            │
                     Render Deployment
                            │
                            ▼
                         MongoDB
                       Production DB
```

---

# ☁️ Production Deployment

The application is deployed using three main infrastructure components.

| Component   | Technology         | Platform |
| ----------- | ------------------ | -------- |
| Frontend    | React / JavaScript | Vercel   |
| Backend     | API Server         | Render   |
| Database    | MongoDB            | MongoDB  |
| Source Code | Git                | GitHub   |

### Deployment Flow

```text
GitHub
   │
   ├───────────────┐
   │               │
   ▼               ▼
Vercel           Render
Frontend         Backend
   │               │
   │               │
   └───────┬───────┘
           │
           ▼
        MongoDB
```

---

# 🛠️ Tech Stack

## Frontend

* React
* JavaScript
* HTML5
* CSS3
* Responsive UI
* Component-based architecture

## Backend

* Backend API
* REST API architecture
* Server-side order processing
* Request validation
* Database integration

## Database

* MongoDB
* MongoDB collections for application data
* Persistent order and menu storage

## Deployment

### Frontend

**Vercel**

The customer-facing frontend is deployed on Vercel.

### Backend

**Render**

The backend API is deployed as a Render web service.

### Database

**MongoDB**

MongoDB is used as the production database.

## Source Control

**GitHub**

The complete project source code is maintained in GitHub.

---

# 📂 Project Structure

The repository contains the application source code for the frontend and backend.

A typical structure is:

```text
50-50-Chinese-Fast-Food/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── ...
│   │
│   ├── public/
│   ├── package.json
│   └── ...
│
├── backend/
│   ├── ...
│   ├── package.json
│   └── ...
│
├── README.md
└── ...
```

> The exact folder structure may vary according to the current repository implementation.

---

# 🔄 Application Workflow

The customer ordering workflow works approximately as follows:

```text
1. Customer opens website
          ↓
2. Customer selects restaurant/table
          ↓
3. Menu is displayed
          ↓
4. Customer selects food items
          ↓
5. Items are added to cart
          ↓
6. Customer reviews cart
          ↓
7. Order is submitted
          ↓
8. Frontend sends API request
          ↓
9. Backend validates order
          ↓
10. Order is stored in MongoDB
          ↓
11. Order response is returned
          ↓
12. Customer receives confirmation
```

---

# 🪑 Table Ordering Workflow

The restaurant can provide customers with table-specific access.

For example:

```text
Customer at Table 01
        │
        ▼
Table 01 URL
        │
        ▼
Menu
        │
        ▼
Cart
        │
        ▼
Order
        │
        ▼
MongoDB
```

This makes it possible to associate an order with a particular restaurant table.

---

# 🔌 Backend API

The frontend communicates with the backend through API requests.

The backend is responsible for:

* Menu data
* Customer requests
* Cart/order processing
* Order creation
* Table information
* Database operations

The frontend should communicate with the production backend URL through an environment variable rather than hard-coding the API endpoint.

Example:

```text
VITE_API_URL=https://your-backend.onrender.com
```

The exact variable name should match the implementation in the repository.

---

# 🗄️ MongoDB Database

MongoDB is used as the production database.

The database stores application information such as:

```text
Menu Items
    │
    ├── Name
    ├── Description
    ├── Price
    ├── Category
    └── Availability

Orders
    │
    ├── Table
    ├── Items
    ├── Quantity
    ├── Total
    └── Order Information
```

MongoDB provides persistent storage between application requests.

The database connection string should always be stored securely as an environment variable.

---

# 🔐 Environment Variables

Production credentials should not be stored directly in the GitHub repository.

Typical backend configuration may include:

```text
MONGODB_URI=your_mongodb_connection_string
```

Frontend configuration may include:

```text
VITE_API_URL=https://your-backend.onrender.com
```

The exact variables depend on the current application configuration.

---

# 💻 Local Development

## 1. Clone the Repository

```bash
git clone https://github.com/Kunal-debug1/50-50-Chinese-Fast-Food.git
```

Navigate into the project:

```bash
cd 50-50-Chinese-Fast-Food
```

---

# 🎨 Frontend Setup

Navigate to the frontend directory if the repository separates frontend and backend applications:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend will normally be available at a local development URL provided by the framework.

---

# ⚙️ Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Install dependencies according to the backend's package configuration.

Configure the MongoDB connection:

```text
MONGODB_URI=your_local_or_cloud_mongodb_uri
```

Start the backend server using the project's configured development command.

---

# 🧪 Testing

Before deploying changes, test the complete ordering workflow.

### Frontend

* [ ] Website loads correctly
* [ ] Menu displays correctly
* [ ] Food categories work
* [ ] Food details display correctly
* [ ] Add to cart works
* [ ] Quantity updates work
* [ ] Remove item works
* [ ] Cart total is correct
* [ ] Mobile layout works

### Backend

* [ ] API starts successfully
* [ ] MongoDB connection works
* [ ] Menu API works
* [ ] Order API works
* [ ] Table information is processed correctly
* [ ] Invalid requests are handled correctly

### Production

* [ ] Vercel frontend loads
* [ ] Render backend is reachable
* [ ] Frontend connects to production API
* [ ] MongoDB connection works
* [ ] Orders are saved successfully
* [ ] Table information is preserved

---

# 🚀 Deployment Workflow

The recommended deployment workflow is:

```text
Developer
    │
    ▼
Local Development
    │
    ├── Frontend Testing
    ├── Backend Testing
    └── MongoDB Testing
    │
    ▼
GitHub
    │
    ├──────────────────┐
    │                  │
    ▼                  ▼
  Vercel             Render
Frontend             Backend
    │                  │
    └────────┬─────────┘
             │
             ▼
          MongoDB
```

When changes are pushed to the connected GitHub repository, the configured deployment platforms can build and deploy the corresponding application.

---

# 🌐 Production Infrastructure

## Frontend — Vercel

The customer-facing application is hosted on **Vercel**.

Vercel handles:

* Frontend deployment
* Static asset delivery
* Production builds
* CDN delivery
* HTTPS

---

## Backend — Render

The backend API is hosted on **Render**.

Render handles:

* Backend application hosting
* Server execution
* Production API
* Environment variables
* Application logs
* Deployment

---

## Database — MongoDB

MongoDB provides persistent application storage.

The backend connects to MongoDB to:

* Read menu data
* Store orders
* Retrieve orders
* Manage application data

---

# 📊 Project Architecture Summary

```text
┌──────────────────────────────┐
│          Customer            │
│        Mobile / Web          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Vercel              │
│      React Frontend          │
└──────────────┬───────────────┘
               │
               │ REST API
               ▼
┌──────────────────────────────┐
│           Render             │
│       Backend API            │
└──────────────┬───────────────┘
               │
               │ Database Queries
               ▼
┌──────────────────────────────┐
│          MongoDB             │
│      Production Database     │
└──────────────────────────────┘
```

---

# 📈 Possible Future Enhancements

Potential improvements for the restaurant platform include:

* Restaurant admin dashboard
* Real-time order management
* Kitchen display system
* Order status tracking
* Online payment integration
* UPI payment support
* Customer order history
* Table availability management
* QR code generation for tables
* Digital bill generation
* WhatsApp order notifications
* Email notifications
* Menu management dashboard
* Inventory management
* Sales analytics
* Daily revenue reports
* Customer analytics
* Multiple restaurant branch support

---

# 📋 Project Information

| Category         | Details                              |
| ---------------- | ------------------------------------ |
| Project          | 50-50 Chinese Fast Food              |
| Type             | Restaurant Ordering Platform         |
| Frontend         | React                                |
| Backend          | API-based backend                    |
| Database         | MongoDB                              |
| Frontend Hosting | Vercel                               |
| Backend Hosting  | Render                               |
| Source Control   | GitHub                               |
| Repository       | Kunal-debug1/50-50-Chinese-Fast-Food |
| Ordering         | Online / Table-Based                 |
| Responsive       | Yes                                  |

---

# 👨‍💻 Developer

**Kunal Gaikwad**

Python Developer | Django Developer | AI Enthusiast

### GitHub Repository

https://github.com/Kunal-debug1/50-50-Chinese-Fast-Food

---

# ⭐ Support

If you find this project useful:

* ⭐ Star the repository
* 🍴 Fork the project
* 🛠️ Contribute improvements
* 📢 Share the project

---

# 📄 License

This project is licensed under the **MIT License** unless otherwise specified in the repository.

---

> **50-50 Chinese Fast Food** provides a digital restaurant ordering experience with a React frontend deployed on Vercel, a backend API deployed on Render, and MongoDB for persistent data storage.
