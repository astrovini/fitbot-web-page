const fs = require('fs');
require('dotenv').config();

// Create public directory if it doesn't exist
if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
}

// Read the template file
const template = fs.readFileSync('src/fitbot-app.html', 'utf8');

// Replace placeholders with environment variables
const output = template
  .replace('__SUPABASE_URL__', process.env.VITE_SUPABASE_URL)
  .replace('__SUPABASE_ANON_KEY__', process.env.VITE_SUPABASE_ANON_KEY);

// Write the output files to public directory
fs.writeFileSync('public/fitbot-app.html', output);
fs.copyFileSync('src/index.html', 'public/index.html');

console.log('Build complete!');
