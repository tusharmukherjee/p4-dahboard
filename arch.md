pbackend/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   │   └── env.ts
│   ├── modules/
│   │   ├── contracts.ts
│   │   ├── base-module.ts
│   │   ├── module-registry.ts
│   │   ├── date-time/
│   │   │   └── date-time-module.ts
│   │   ├── spotify/
│   │   │   └── spotify-module.ts
│   │   └── calendar/
│   │       └── calendar-module.ts
│   ├── devices/
│   │   ├── device-config-service.ts
│   │   └── device-config-repository.ts
│   ├── auth/
│   │   ├── auth-service.ts
│   │   └── auth-middleware.ts
│   ├── routes/
│   │   ├── module-routes.ts
│   │   └── device-routes.ts
│   └── errors/
│       └── app-error.ts
├── tests/
├── .env.example
├── package.json
└── tsconfig.json