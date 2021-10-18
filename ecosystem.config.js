module.exports = {
  apps: [
    {
      name: "Events gateway",
      script: "eventsGateway.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Account service",
      script: "serverAccounts.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Analytics service",
      script: "serverAnalytics.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Dispatch service",
      script: "serverDispatch.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Map service",
      script: "serverMap.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Pricing service",
      script: "serverPricing.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Search service",
      script: "serverSearch.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Payment service",
      script: "serverPayments.js",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Watcher service",
      script: "serverWatcher.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
