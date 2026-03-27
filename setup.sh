#!/bin/bash
# DompetKu — Quick Setup Script
# Run: chmod +x setup.sh && ./setup.sh

set -e

echo "🚀 DompetKu — Setting up..."
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install Node.js first: https://nodejs.org"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check .env.local
if [ ! -f .env.local ]; then
    echo ""
    echo "📝 Creating .env.local..."
    cat > .env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://yvapmbjtuhqvsunkmkxw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YXBtYmp0dWhxdnN1bmtta3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE5MTUsImV4cCI6MjA5MDE4NzkxNX0.43GX-erC2vZ0QdOC53bdWN7isBpKDrrSvYCuMF6g1Ro
EOF
    echo "✅ .env.local created"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To run locally:  npm run dev"
echo "To deploy:       npx vercel --prod"
echo ""
echo "📖 Read DEPLOY.md for detailed deployment instructions"
