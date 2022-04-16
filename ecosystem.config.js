module.exports = {
  apps: [
    {
      name: "Events gateway",
      script: "eventsGateway.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Account service",
      script: "serverAccounts.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Analytics service",
      script: "serverAnalytics.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Dispatch service",
      script: "serverDispatch.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Map service",
      script: "serverMap.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Pricing service",
      script: "serverPricing.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Search service",
      script: "serverSearch.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Payment service",
      script: "serverPayments.js",
      instances: 2,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Smart cache service",
      script: "SmartCacher.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
