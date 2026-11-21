package glance

import _ "embed"

// DashboardConfigJSON embeds dashboard.config.json so Vercel Go serverless
// functions can read it reliably without relying on working directory paths.
//
//go:embed dashboard.config.json
var DashboardConfigJSON []byte
