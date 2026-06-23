# Velo - Secure Messenger

A modern, end-to-end encrypted messaging application built with React Native and Node.js. Velo prioritizes user privacy and security while maintaining an intuitive and user-friendly interface.

![Version](https://img.shields.io/badge/version-0.0.1-blue)
![License](https://img.shields.io/badge/license-ISC-green)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-blue)

## 🔐 Overview

Velo is a secure messaging platform that combines modern cryptography with a seamless user experience. It uses **end-to-end encryption (X3DH)** to ensure that only intended recipients can read messages. The application is built with a focus on security, privacy, and usability for everyday users.

### Key Highlights

- ✅ **End-to-End Encryption**: Messages are encrypted using X3DH key exchange and TweetNaCl
- ✅ **Real-time Messaging**: Instant message delivery via WebSocket
- ✅ **Secure Authentication**: JWT-based authentication with bcrypt password hashing
- ✅ **Cross-Platform**: Native iOS and Android support via React Native
- ✅ **Push Notifications**: Firebase Cloud Messaging integration
- ✅ **Modern UI/UX**: Built with React Native and styled with NativeWind (Tailwind CSS)

---

## 🏗️ Architecture

Velo follows a **multi-layered architecture** designed for security, scalability, and maintainability:

```
┌──────────────────────┐
│      UI Layer        │
│   (React Native)     │
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│ Application Layer    │
│  (Business Logic)    │
└─────────┬────────────┘
          │
    ┌─────┴─────┬──────────┬─────────────┐
    │           │          │             │
┌───▼──┐  ┌──────▼───┐ ┌──▼────┐  ┌────▼────┐
│ Chat │  │ Auth     │ │ User  │  │Notif    │
│Service│  │Service   │ │Service│  │Service  │
└───┬──┘  └──────┬───┘ └──┬────┘  └────┬────┘
    │            │        │            │
    └────────────┬────────┴────────────┘
                 │
        ┌────────▼─────────┐
        │  Crypto Layer    │
        │ - X3DH           │
        │ - TweetNaCl      │
        │ - SHA-256        │
        └────────┬─────────┘
                 │
        ┌────────▼──────────┐
        │  Data Layer       │
        │  (Storage / DB)   │
        └────────┬──────────┘
                 │
        ┌────────▼──────────┐
        │ Network Layer     │
        │ (Socket.io/API)   │
        └───────────────────┘
```

### Architecture Layers

#### **UI Layer**
- React Native interface
- Displays data and captures user interactions
- Delegates complex logic to business layer

#### **Application Layer**
- Orchestrates business logic and user scenarios
- Manages application state (Zustand)
- Coordinates between services

#### **Service Layer**
- **Chat Service**: Message delivery, encryption coordination
- **Auth Service**: Registration, login, session management
- **User Service**: User search, profile management
- **Notification Service**: Push notification handling

#### **Crypto Layer**
- X3DH key exchange for secure session establishment
- TweetNaCl for message encryption/decryption
- SHA-256 for hashing
- Isolated from UI for enhanced security

#### **Data Layer**
- Local device storage (AsyncStorage)
- Server-side MongoDB

#### **Network Layer**
- Express API endpoints
- Socket.io for real-time communication

---

## 🛠️ Tech Stack

### Client (React Native)

| Technology | Purpose |
|-----------|---------|
| **React Native** | Cross-platform mobile development |
| **TypeScript** | Type-safe development |
| **React Navigation** | App navigation and routing |
| **Zustand** | State management |
| **NativeWind** | Tailwind CSS styling |
| **Socket.io Client** | Real-time messaging |
| **TweetNaCl** | Cryptographic operations |
| **Firebase** | Push notifications, authentication |
| **React Hook Form** | Form management |
| **Axios** | HTTP client |

### Server (Node.js)

| Technology | Purpose |
|-----------|---------|
| **Express.js** | REST API framework |
| **TypeScript** | Type-safe backend |
| **Socket.io** | WebSocket communication |
| **MongoDB/Mongoose** | Database |
| **Firebase Admin SDK** | Push notifications |
| **JWT** | Token-based authentication |
| **bcrypt** | Password hashing |
| **Helmet** | Security headers |
| **CORS** | Cross-origin request handling |

---

## 📱 Features

### User Authentication
- User registration with email verification
- Secure login with JWT tokens
- Password hashing with bcrypt
- Session management

### Messaging
- Real-time message delivery
- Message history
- Typing indicators
- Online/offline status
- Message read receipts

### Security
- End-to-end encryption for all messages
- X3DH key exchange protocol
- Secure key storage in device keychain
- Message authenticity verification
- User fingerprint verification

### User Interface
- Intuitive chat list with search
- Real-time message streaming
- User search and discovery
- Settings and preferences
- Security information display
- Tab-based navigation

### Push Notifications
- Firebase Cloud Messaging integration
- Background message handling
- Notification preferences

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 16+ and npm/yarn
- **MongoDB** (for server development)
- **Firebase Project** (for authentication and notifications)
- **Xcode** 14+ (for iOS development)
- **Android Studio** (for Android development)
- **React Native CLI**: `npm install -g react-native`

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/velo.git
cd velo
```

#### 2. Set Up Environment Variables

**Server (.env)**
```bash
cd chats-server
cp .env.example .env  # Create based on your configuration
```

Fill in:
```
MONGODB_URI=mongodb://localhost:27017/velo
JWT_SECRET=your_jwt_secret_key
FIREBASE_PROJECT_ID=your_firebase_project
NODE_ENV=development
PORT=5000
```

**Client (.env)**
```bash
cd ../chats-client
cp .env.example .env
```

Fill in:
```
API_URL=http://localhost:5000
FIREBASE_CONFIG=your_firebase_config
```

#### 3. Install Dependencies

**Server**
```bash
cd chats-server
npm install
```

**Client**
```bash
cd chats-client
npm install
cd ios && pod install && cd ..  # For iOS
```

---

## 💻 Development

### Starting the Server

```bash
cd chats-server
npm start
```

The server will start on `http://localhost:5000` with hot-reload enabled via nodemon.

### Starting the Client

**iOS**
```bash
cd chats-client
npm run ios
```

**Android**
```bash
cd chats-client
npm run android
```

**Development Server**
```bash
cd chats-client
npm start
```

---

## 📋 Project Structure

```
velo/
├── chats-client/              # React Native mobile app
│   ├── src/
│   │   ├── app/               # Navigation setup
│   │   ├── screens/           # Screen components
│   │   ├── components/        # Reusable components
│   │   ├── store/             # Zustand stores
│   │   ├── shared/
│   │   │   ├── api/           # API services
│   │   │   ├── chat/          # Chat utilities
│   │   │   ├── crypto/        # Encryption logic
│   │   │   ├── socket/        # WebSocket client
│   │   │   ├── notifications/ # Notification handlers
│   │   │   └── storage/       # Local storage
│   │   └── theme/             # Theme configuration
│   ├── android/               # Android native code
│   └── ios/                   # iOS native code
│
├── chats-server/              # Express.js backend
│   ├── src/
│   │   ├── models/            # MongoDB schemas
│   │   ├── routes/            # API endpoints
│   │   ├── middleware/        # Express middleware
│   │   ├── socket/            # Socket.io setup
│   │   ├── push/              # Firebase messaging
│   │   ├── utils/             # Helper functions
│   │   └── config.ts          # Configuration
│   └── package.json
│
├── architecture.md            # Detailed architecture documentation
├── UserFlow.md                # User flow diagrams
├── UX.md                       # UI/UX design specifications
└── README.md                   # This file
```

---

## 🔐 Security Considerations

### Encryption

- **Message Encryption**: Uses TweetNaCl (libsodium) for encryption
- **Key Exchange**: X3DH protocol for secure key establishment
- **Key Storage**: Private keys stored in device's secure keychain
- **Hash Functions**: SHA-256 for integrity verification

### Authentication

- **JWT Tokens**: Used for API authentication
- **Password Hashing**: bcrypt with configurable salt rounds
- **Session Management**: Server-side session tracking
- **HTTPS/WSS**: Always use secure connections in production

### Best Practices

1. **Never log sensitive data** (private keys, tokens, etc.)
2. **Rotate keys periodically**
3. **Verify user fingerprints** for first-time contacts
4. **Keep dependencies updated**
5. **Use environment variables** for sensitive configuration

---

## 🧪 Testing

### Client Tests
```bash
cd chats-client
npm test
```

### Server Tests
```bash
cd chats-server
npm test
```

### Linting

**Client**
```bash
cd chats-client
npm run lint
```

---

## 📚 Documentation

- [Architecture Documentation](./architecture.md) - Detailed system architecture
- [User Flow Documentation](./UserFlow.md) - User interaction flows
- [UI/UX Documentation](./UX.md) - Interface design specifications
- [Session Establishment Policy](./SESSION_ESTABLISHMENT_POLICY.md) - Encryption session setup
- [UI Realization](./UI_realization.md) - UI component implementation guide

---

## 🐛 Known Issues & Limitations

- Message history is limited to the current session (future: implement persistent storage)
- File sharing is not yet implemented
- Group messaging coming in v2
- End-to-end video/audio calls planned for future releases

See [V2_STABILIZATION_CHECKLIST.md](./V2_STABILIZATION_CHECKLIST.md) for the development roadmap.

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Code Style

- Use TypeScript strictly
- Follow ESLint configuration
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed

---

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

---

## 👨‍💻 Authors

- **Deus_Kh** - Backend Development

---

## 🙏 Acknowledgments

- React Native team for the excellent mobile framework
- TweetNaCl for robust cryptography
- Express and Socket.io communities
- Firebase for push notification infrastructure

---

## 📞 Support

For questions, issues, or feature requests:
- Open an issue on GitHub
- Check existing documentation
- Review [ROADMAP.md](./ROADMAP.md) for planned features

---

## 🗺️ Roadmap

See [ROADMAP.md](./ROADMAP.md) for detailed feature roadmap and future plans.

Current focus areas:
- ✅ Core messaging functionality
- ✅ End-to-end encryption
- 🔄 Message persistence
- 🔄 Group chats
- 🔄 Media sharing
- 🔄 Voice/Video calls

---

**Built with ❤️ for secure, private communication**
