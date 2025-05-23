'use client'

import superjson from 'superjson'
import { httpBatchLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { PropsWithChildren, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'

import type { AppRouter } from '@/trpc/routers/_app'
import { makeQueryClient } from '@/trpc/query-client'
import { absoluteUrl } from '@/lib/utils'

export const trpc = createTRPCReact<AppRouter>()

let browserQueryClient: QueryClient

function getQueryClient() {
	if (typeof window === 'undefined') {
		// Server: always make a new query client
		return makeQueryClient()
	}

	// Browser: make a new query client if we don't already have one
	// This is very important, so we don't re-make a new client if React
	// suspends during the initial render. This may not be needed if we
	// have a suspense boundary BELOW the creation of the query client
	if (!browserQueryClient) browserQueryClient = makeQueryClient()

	return browserQueryClient
}

const fullUrl = absoluteUrl('/api/trpc')

export function TRPCProvider(props: PropsWithChildren) {
	// NOTE: Avoid useState when initializing the query client if you don't
	//       have a suspense boundary between this and the code that may
	//       suspend because React will throw away the client on the initial
	//       render if it suspends and there is no boundary
	const queryClient = getQueryClient()

	const [trpcClient] = useState<ReturnType<typeof trpc.createClient>>(() =>
		trpc.createClient({
			links: [
				httpBatchLink({
					transformer: superjson,
					url: fullUrl,
					async headers() {
						const headers = new Headers()
						headers.set('x-trpc-source', 'nextjs-react')
						return headers
					},
				}),
			],
		}),
	)

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
		</trpc.Provider>
	)
}
