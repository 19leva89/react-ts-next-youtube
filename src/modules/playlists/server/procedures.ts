import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, getTableColumns, lt, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { createTRPCRouter, protectedProcedure } from '@/trpc/init'
import { playlists, playlistVideos, users, videoReactions, videos, videoViews } from '@/db/schema'

export const playlistsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { name } = input
			const {
				user: { id: userId },
			} = ctx

			const [newPlaylist] = await db
				.insert(playlists)
				.values({
					userId,
					name,
				})
				.returning()

			if (!newPlaylist) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to create playlist',
				})
			}

			return newPlaylist
		}),

	addVideo: protectedProcedure
		.input(
			z.object({
				playlistId: z.string().cuid2(),
				videoId: z.string().cuid2(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { playlistId, videoId } = input
			const {
				user: { id: userId },
			} = ctx

			const [existingPlaylist] = await db
				.select()
				.from(playlists)
				.where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))

			if (!existingPlaylist) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const [existingVideo] = await db.select().from(videos).where(eq(videos.id, videoId))

			if (!existingVideo) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const [existingPlaylistVideo] = await db
				.select()
				.from(playlistVideos)
				.where(and(eq(playlistVideos.playlistId, playlistId), eq(playlistVideos.videoId, videoId)))

			if (existingPlaylistVideo) {
				throw new TRPCError({
					code: 'CONFLICT',
				})
			}

			const [newPlaylistVideo] = await db
				.insert(playlistVideos)
				.values({
					playlistId,
					videoId,
				})
				.returning()

			if (!newPlaylistVideo) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
				})
			}

			return newPlaylistVideo
		}),

	removeVideo: protectedProcedure
		.input(
			z.object({
				playlistId: z.string().cuid2(),
				videoId: z.string().cuid2(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { playlistId, videoId } = input
			const {
				user: { id: userId },
			} = ctx

			const [existingPlaylist] = await db
				.select()
				.from(playlists)
				.where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))

			if (!existingPlaylist) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const [existingVideo] = await db.select().from(videos).where(eq(videos.id, videoId))

			if (!existingVideo) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const [existingPlaylistVideo] = await db
				.select()
				.from(playlistVideos)
				.where(and(eq(playlistVideos.playlistId, playlistId), eq(playlistVideos.videoId, videoId)))

			if (!existingPlaylistVideo) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const [removedPlaylistVideo] = await db
				.delete(playlistVideos)
				.where(and(eq(playlistVideos.playlistId, playlistId), eq(playlistVideos.videoId, videoId)))
				.returning()

			if (!removedPlaylistVideo) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
				})
			}

			return removedPlaylistVideo
		}),

	getMany: protectedProcedure
		.input(
			z.object({
				cursor: z
					.object({
						id: z.string().cuid2(),
						updatedAt: z.date(),
					})
					.nullish(),
				limit: z.number().min(1).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { cursor, limit } = input
			const {
				user: { id: userId },
			} = ctx

			const data = await db
				.select({
					...getTableColumns(playlists),
					videoCount: db.$count(playlistVideos, eq(playlistVideos.playlistId, playlists.id)),
					user: users,
					thumbnailUrl: sql<string | null>`(
            SELECT v.thumbnail_url
            FROM ${playlistVideos} pv
            JOIN ${videos} v ON v.id = pv.video_id
            WHERE pv.playlist_id = ${playlists.id}
            ORDER BY pv.updated_at DESC
            LIMIT 1
          )`,
				})
				.from(playlists)
				.innerJoin(users, eq(playlists.userId, users.id))
				.where(
					and(
						eq(playlists.userId, userId),
						cursor
							? or(
									lt(playlists.updatedAt, cursor.updatedAt),
									and(eq(playlists.updatedAt, cursor.updatedAt), lt(playlists.id, cursor.id)),
								)
							: undefined,
					),
				)
				.orderBy(desc(playlists.updatedAt), desc(playlists.id))
				// Add 1 to the limit to check if there are more data
				.limit(limit + 1)

			const hasMore = data.length > limit

			// Remove the last item if there is more data
			const items = hasMore ? data.slice(0, -1) : data

			// Set the next cursor to the last item if there is more data
			const lastItem = items[items.length - 1]

			const nextCursor = hasMore
				? {
						id: lastItem.id,
						updatedAt: lastItem.updatedAt,
					}
				: null

			return { items, nextCursor }
		}),

	getManyForVideo: protectedProcedure
		.input(
			z.object({
				videoId: z.string().cuid2(),
				cursor: z
					.object({
						id: z.string().cuid2(),
						updatedAt: z.date(),
					})
					.nullish(),
				limit: z.number().min(1).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { cursor, limit, videoId } = input
			const {
				user: { id: userId },
			} = ctx

			const data = await db
				.select({
					...getTableColumns(playlists),
					videoCount: db.$count(playlistVideos, eq(playlistVideos.playlistId, playlists.id)),
					user: users,
					containsVideo: videoId
						? sql<boolean>`(
                SELECT EXISTS (
                  SELECT 1
                  FROM ${playlistVideos} pv
                  WHERE pv.playlist_id = ${playlists.id} AND pv.video_id = ${videoId}
                )
            )`
						: sql<boolean>`false`,
				})
				.from(playlists)
				.innerJoin(users, eq(playlists.userId, users.id))
				.where(
					and(
						eq(playlists.userId, userId),
						cursor
							? or(
									lt(playlists.updatedAt, cursor.updatedAt),
									and(eq(playlists.updatedAt, cursor.updatedAt), lt(playlists.id, cursor.id)),
								)
							: undefined,
					),
				)
				.orderBy(desc(playlists.updatedAt), desc(playlists.id))
				// Add 1 to the limit to check if there are more data
				.limit(limit + 1)

			const hasMore = data.length > limit

			// Remove the last item if there is more data
			const items = hasMore ? data.slice(0, -1) : data

			// Set the next cursor to the last item if there is more data
			const lastItem = items[items.length - 1]
			const nextCursor = hasMore
				? {
						id: lastItem.id,
						updatedAt: lastItem.updatedAt,
					}
				: null

			return { items, nextCursor }
		}),

	getHistory: protectedProcedure
		.input(
			z.object({
				cursor: z
					.object({
						id: z.string().cuid2(),
						viewedAt: z.date(),
					})
					.nullish(),
				limit: z.number().min(1).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { cursor, limit } = input
			const {
				user: { id: userId },
			} = ctx

			const viewerVideoViews = db.$with('viewer_video_views').as(
				db
					.select({
						videoId: videoViews.videoId,
						viewedAt: videoViews.updatedAt,
					})
					.from(videoViews)
					.where(eq(videoViews.userId, userId)),
			)

			const data = await db
				.with(viewerVideoViews)
				.select({
					...getTableColumns(videos),
					user: users,
					viewedAt: viewerVideoViews.viewedAt,
					viewCount: db.$count(videoViews, eq(videoViews.videoId, videos.id)),
					likeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'like')),
					),
					dislikeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'dislike')),
					),
				})
				.from(videos)
				.innerJoin(users, eq(videos.userId, users.id))
				.innerJoin(viewerVideoViews, eq(videos.id, viewerVideoViews.videoId))
				.where(
					and(
						eq(videos.visibility, 'public'),
						cursor
							? or(
									lt(viewerVideoViews.viewedAt, cursor.viewedAt),
									and(eq(viewerVideoViews.viewedAt, cursor.viewedAt), lt(videos.id, cursor.id)),
								)
							: undefined,
					),
				)
				.orderBy(desc(videos.updatedAt), desc(videos.id))
				// Add 1 to the limit to check if there are more data
				.limit(limit + 1)

			const hasMore = data.length > limit

			// Remove the last item if there is more data
			const items = hasMore ? data.slice(0, -1) : data

			// Set the next cursor to the last item if there is more data
			const lastItem = items[items.length - 1]

			const nextCursor = hasMore
				? {
						id: lastItem.id,
						viewedAt: lastItem.viewedAt,
					}
				: null

			return { items, nextCursor }
		}),

	getLiked: protectedProcedure
		.input(
			z.object({
				cursor: z
					.object({
						id: z.string().cuid2(),
						likedAt: z.date(),
					})
					.nullish(),
				limit: z.number().min(1).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { cursor, limit } = input
			const {
				user: { id: userId },
			} = ctx

			const viewerVideoReactions = db.$with('viewer_video_reactions').as(
				db
					.select({
						videoId: videoReactions.videoId,
						likedAt: videoReactions.createdAt,
					})
					.from(videoReactions)
					.where(and(eq(videoReactions.userId, userId), eq(videoReactions.type, 'like'))),
			)

			const data = await db
				.with(viewerVideoReactions)
				.select({
					...getTableColumns(videos),
					user: users,
					likedAt: viewerVideoReactions.likedAt,
					viewCount: db.$count(videoViews, eq(videoViews.videoId, videos.id)),
					likeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'like')),
					),
					dislikeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'dislike')),
					),
				})
				.from(videos)
				.innerJoin(users, eq(videos.userId, users.id))
				.innerJoin(viewerVideoReactions, eq(videos.id, viewerVideoReactions.videoId))
				.where(
					and(
						eq(videos.visibility, 'public'),
						cursor
							? or(
									lt(viewerVideoReactions.likedAt, cursor.likedAt),
									and(eq(viewerVideoReactions.likedAt, cursor.likedAt), lt(videos.id, cursor.id)),
								)
							: undefined,
					),
				)
				.orderBy(desc(viewerVideoReactions.likedAt), desc(videos.id))
				// Add 1 to the limit to check if there are more data
				.limit(limit + 1)

			const hasMore = data.length > limit

			// Remove the last item if there is more data
			const items = hasMore ? data.slice(0, -1) : data

			// Set the next cursor to the last item if there is more data
			const lastItem = items[items.length - 1]

			const nextCursor = hasMore
				? {
						id: lastItem.id,
						likedAt: lastItem.likedAt,
					}
				: null

			return { items, nextCursor }
		}),

	getVideos: protectedProcedure
		.input(
			z.object({
				playlistId: z.string().cuid2(),
				cursor: z
					.object({
						id: z.string().cuid2(),
						updatedAt: z.date(),
					})
					.nullish(),
				limit: z.number().min(1).max(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { playlistId, cursor, limit } = input
			const {
				user: { id: userId },
			} = ctx

			const [existingPlaylist] = await db
				.select()
				.from(playlists)
				.where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))

			if (!existingPlaylist) {
				throw new TRPCError({
					code: 'NOT_FOUND',
				})
			}

			const videosFromPlaylist = db.$with('playlist_videos').as(
				db
					.select({
						videoId: playlistVideos.videoId,
					})
					.from(playlistVideos)
					.where(eq(playlistVideos.playlistId, playlistId)),
			)

			const data = await db
				.with(videosFromPlaylist)
				.select({
					...getTableColumns(videos),
					user: users,
					viewCount: db.$count(videoViews, eq(videoViews.videoId, videos.id)),
					likeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'like')),
					),
					dislikeCount: db.$count(
						videoReactions,
						and(eq(videoReactions.videoId, videos.id), eq(videoReactions.type, 'dislike')),
					),
				})
				.from(videos)
				.innerJoin(users, eq(videos.userId, users.id))
				.innerJoin(videosFromPlaylist, eq(videos.id, videosFromPlaylist.videoId))
				.where(
					and(
						eq(videos.visibility, 'public'),
						cursor
							? or(
									lt(videos.updatedAt, cursor.updatedAt),
									and(eq(videos.updatedAt, cursor.updatedAt), lt(videos.id, cursor.id)),
								)
							: undefined,
					),
				)
				.orderBy(desc(videos.updatedAt), desc(videos.id))
				// Add 1 to the limit to check if there are more data
				.limit(limit + 1)

			const hasMore = data.length > limit

			// Remove the last item if there is more data
			const items = hasMore ? data.slice(0, -1) : data

			// Set the next cursor to the last item if there is more data
			const lastItem = items[items.length - 1]

			const nextCursor = hasMore
				? {
						id: lastItem.id,
						updatedAt: lastItem.updatedAt,
					}
				: null

			return { items, nextCursor }
		}),

	getOne: protectedProcedure.input(z.object({ id: z.string().cuid2() })).query(async ({ input, ctx }) => {
		const { id } = input
		const {
			user: { id: userId },
		} = ctx

		const [existingPlaylist] = await db
			.select()
			.from(playlists)
			.where(and(eq(playlists.id, id), eq(playlists.userId, userId)))

		if (!existingPlaylist) {
			throw new TRPCError({
				code: 'NOT_FOUND',
			})
		}

		return existingPlaylist
	}),

	remove: protectedProcedure.input(z.object({ id: z.string().cuid2() })).mutation(async ({ ctx, input }) => {
		const { id } = input
		const {
			user: { id: userId },
		} = ctx

		const [deletedPlaylist] = await db
			.delete(playlists)
			.where(and(eq(playlists.id, id), eq(playlists.userId, userId)))
			.returning()

		if (!deletedPlaylist) {
			throw new TRPCError({
				code: 'NOT_FOUND',
			})
		}

		return deletedPlaylist
	}),
})
