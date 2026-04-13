import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_URL: process.env.APP_URL,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cfwbtyclcxzyprclzufk.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

export default nextConfig
