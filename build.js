const fs = require('fs');
require('dotenv').config();

// Read the template file
const template = fs.readFileSync('src/fitbot-app.html', 'utf8');

// Replace placeholders with environment variables
const output = template
  .replace('__SUPABASE_URL__', process.env.VITE_SUPABASE_URL)
  .replace('__SUPABASE_ANON_KEY__', process.env.VITE_SUPABASE_ANON_KEY);

// Write the output file
fs.writeFileSync('fitbot-app.html', output);

// Copy index.html to root
fs.copyFileSync('src/index.html', 'index.html');

console.log('Build complete!');
