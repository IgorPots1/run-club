'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyRunCommentInsert,
  applyRunCommentLikeState,
  applyRunCommentUpdate,
  createOptimisticDeletedRunComment,
  createRunComment,
  deleteRunComment,
  loadRunCommentAuthorProfile,
  resolveRunCommentRealtimeItem,
  subscribeToRunCommentLikes,
  subscribeToRunComments,
  toggleRunCommentLike,
  updateRunComment,
  type RunCommentAuthorIdentity,
  type RunCommentItem,
  type RunCommentLikeRealtimeRow,
  type RunCommentRealtimeRow,
} from '@/lib/run-comments'

function getRunCommentUpdateSignature(
  comment:
    | Pick<RunCommentItem, 'id' | 'editedAt' | 'deletedAt'>
    | Pick<RunCommentRealtimeRow, 'id' | 'edited_at' | 'deleted_at'>
) {
  const editedAt = 'editedAt' in comment ? comment.editedAt : comment.edited_at
  const deletedAt = 'deletedAt' in comment ? comment.deletedAt : comment.deleted_at
  return `${comment.id}:${editedAt ?? ''}:${deletedAt ?? ''}`
}

function getRunCommentLikeEchoKey(
  commentLike:
    | Pick<RunCommentLikeRealtimeRow, 'comment_id' | 'user_id'>
    | { commentId: string; userId: string }
) {
  const commentId = 'comment_id' in commentLike ? commentLike.comment_id : commentLike.commentId
  const userId = 'user_id' in commentLike ? commentLike.user_id : commentLike.userId
  return `${commentId}:${userId}`
}

type UseRunCommentsControllerParams = {
  runId: string
  currentUserId?: string | null
  onAuthRequired?: () => void
}

export function useRunCommentsController({
  runId,
  currentUserId = null,
  onAuthRequired,
}: UseRunCommentsControllerParams) {
  const [comments, setComments] = useState<RunCommentItem[]>([])
  const [pendingLikeCommentIds, setPendingLikeCommentIds] = useState<Record<string, boolean>>({})
  const commentsRef = useRef<RunCommentItem[]>([])
  const authorIdentitiesRef = useRef<Map<string, RunCommentAuthorIdentity>>(new Map())
  const pendingLocalCreateEchoesRef = useRef<Set<string>>(new Set())
  const pendingLocalUpdateEchoesRef = useRef<Map<string, string>>(new Map())
  const pendingLocalLikeInsertEchoesRef = useRef<Set<string>>(new Set())
  const pendingLocalLikeDeleteEchoesRef = useRef<Set<string>>(new Set())

  const applyComments = useCallback(
    (updater: RunCommentItem[] | ((previousComments: RunCommentItem[]) => RunCommentItem[])) => {
      setComments((previousComments) => {
        const nextComments =
          typeof updater === 'function'
            ? (updater as (currentComments: RunCommentItem[]) => RunCommentItem[])(previousComments)
            : updater

        commentsRef.current = nextComments
        return nextComments
      })
    },
    []
  )

  const rememberAuthorIdentity = useCallback((comment: RunCommentItem) => {
    authorIdentitiesRef.current.set(comment.userId, {
      userId: comment.userId,
      displayName: comment.displayName,
      nickname: comment.nickname,
      avatarUrl: comment.avatarUrl,
    })
  }, [])

  const replaceComments = useCallback(
    (nextComments: RunCommentItem[]) => {
      authorIdentitiesRef.current.clear()
      nextComments.forEach((comment) => {
        rememberAuthorIdentity(comment)
      })
      commentsRef.current = nextComments
      setComments(nextComments)
    },
    [rememberAuthorIdentity]
  )

  useEffect(() => {
    commentsRef.current = comments

    const nextAuthorIdentities = new Map<string, RunCommentAuthorIdentity>()
    comments.forEach((comment) => {
      nextAuthorIdentities.set(comment.userId, {
        userId: comment.userId,
        displayName: comment.displayName,
        nickname: comment.nickname,
        avatarUrl: comment.avatarUrl,
      })
    })
    authorIdentitiesRef.current = nextAuthorIdentities
  }, [comments])

  useEffect(() => {
    pendingLocalCreateEchoesRef.current.clear()
    pendingLocalUpdateEchoesRef.current.clear()
    pendingLocalLikeInsertEchoesRef.current.clear()
    pendingLocalLikeDeleteEchoesRef.current.clear()
    commentsRef.current = []
    authorIdentitiesRef.current.clear()
    setComments([])
    setPendingLikeCommentIds({})
  }, [runId])

  const resolveAuthorIdentity = useCallback(async (userId: string) => {
    const knownAuthorIdentity = authorIdentitiesRef.current.get(userId) ?? null

    if (knownAuthorIdentity) {
      return knownAuthorIdentity
    }

    try {
      const loadedAuthorIdentity = await loadRunCommentAuthorProfile(userId)
      authorIdentitiesRef.current.set(userId, loadedAuthorIdentity)
      return loadedAuthorIdentity
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!runId) {
      return
    }

    return subscribeToRunComments(runId, {
      onInsert: (commentRow) => {
        void (async () => {
          if (pendingLocalCreateEchoesRef.current.has(commentRow.id)) {
            pendingLocalCreateEchoesRef.current.delete(commentRow.id)
            return
          }

          const existingComment = commentsRef.current.find((comment) => comment.id === commentRow.id) ?? null
          const authorIdentity = existingComment ? null : await resolveAuthorIdentity(commentRow.user_id)
          const realtimeComment = resolveRunCommentRealtimeItem(commentRow, {
            existingComment,
            authorIdentity,
          })

          applyComments((previousComments) => applyRunCommentInsert(previousComments, realtimeComment))
        })()
      },
      onUpdate: (commentRow) => {
        void (async () => {
          const updateSignature = getRunCommentUpdateSignature(commentRow)
          const pendingLocalSignature = pendingLocalUpdateEchoesRef.current.get(commentRow.id)

          if (pendingLocalSignature === updateSignature) {
            pendingLocalUpdateEchoesRef.current.delete(commentRow.id)
            return
          }

          const existingComment = commentsRef.current.find((comment) => comment.id === commentRow.id) ?? null
          const authorIdentity = existingComment ? null : await resolveAuthorIdentity(commentRow.user_id)
          const realtimeComment = resolveRunCommentRealtimeItem(commentRow, {
            existingComment,
            authorIdentity,
          })

          applyComments((previousComments) => applyRunCommentUpdate(previousComments, realtimeComment))
        })()
      },
    })
  }, [applyComments, resolveAuthorIdentity, runId])

  useEffect(() => {
    if (!runId) {
      return
    }

    return subscribeToRunCommentLikes(runId, {
      onInsert: (likeRow) => {
        const isOwnLike = Boolean(currentUserId) && likeRow.user_id === currentUserId
        const echoKey = getRunCommentLikeEchoKey(likeRow)

        if (isOwnLike && pendingLocalLikeInsertEchoesRef.current.has(echoKey)) {
          pendingLocalLikeInsertEchoesRef.current.delete(echoKey)
          return
        }

        applyComments((previousComments) =>
          applyRunCommentLikeState(previousComments, {
            commentId: likeRow.comment_id,
            delta: 1,
            likedByMe: isOwnLike ? true : undefined,
          })
        )
      },
      onDelete: (likeRow) => {
        const isOwnLike = Boolean(currentUserId) && likeRow.user_id === currentUserId
        const echoKey = getRunCommentLikeEchoKey(likeRow)

        if (isOwnLike && pendingLocalLikeDeleteEchoesRef.current.has(echoKey)) {
          pendingLocalLikeDeleteEchoesRef.current.delete(echoKey)
          return
        }

        applyComments((previousComments) =>
          applyRunCommentLikeState(previousComments, {
            commentId: likeRow.comment_id,
            delta: -1,
            likedByMe: isOwnLike ? false : undefined,
          })
        )
      },
    })
  }, [applyComments, currentUserId, runId])

  const createComment = useCallback(
    async (comment: string, parentId: string | null = null) => {
      if (!runId) {
        throw new Error('missing_run_id')
      }

      if (!currentUserId) {
        onAuthRequired?.()
        throw new Error('auth_required')
      }

      const createdComment = await createRunComment(runId, {
        comment,
        parentId,
      })

      pendingLocalCreateEchoesRef.current.add(createdComment.id)
      rememberAuthorIdentity(createdComment)
      applyComments((previousComments) => applyRunCommentInsert(previousComments, createdComment))
      return createdComment
    },
    [applyComments, currentUserId, onAuthRequired, rememberAuthorIdentity, runId]
  )

  const editComment = useCallback(
    async (commentId: string, comment: string) => {
      const updatedComment = await updateRunComment(commentId, {
        comment,
      })

      pendingLocalUpdateEchoesRef.current.set(
        updatedComment.id,
        getRunCommentUpdateSignature(updatedComment)
      )
      rememberAuthorIdentity(updatedComment)
      applyComments((previousComments) => applyRunCommentUpdate(previousComments, updatedComment))
      return updatedComment
    },
    [applyComments, rememberAuthorIdentity]
  )

  const deleteComment = useCallback(
    async (commentId: string) => {
      const previousComments = commentsRef.current
      const existingComment = previousComments.find((comment) => comment.id === commentId) ?? null
      const shouldOptimisticallyDelete = Boolean(existingComment && !existingComment.deletedAt)

      if (shouldOptimisticallyDelete && existingComment) {
        const optimisticDeletedComment = createOptimisticDeletedRunComment(existingComment)
        applyComments((currentComments) => applyRunCommentUpdate(currentComments, optimisticDeletedComment))
      }

      try {
        const deletedComment = await deleteRunComment(commentId)

        pendingLocalUpdateEchoesRef.current.set(
          deletedComment.id,
          getRunCommentUpdateSignature(deletedComment)
        )
        rememberAuthorIdentity(deletedComment)
        applyComments((currentComments) => applyRunCommentUpdate(currentComments, deletedComment))
        return deletedComment
      } catch (error) {
        if (shouldOptimisticallyDelete) {
          commentsRef.current = previousComments
          setComments(previousComments)
        }

        throw error
      }
    },
    [applyComments, rememberAuthorIdentity]
  )

  const toggleLikeComment = useCallback(
    async (commentId: string) => {
      if (!currentUserId) {
        onAuthRequired?.()
        return
      }

      if (pendingLikeCommentIds[commentId]) {
        return
      }

      const existingComment = commentsRef.current.find((comment) => comment.id === commentId) ?? null

      if (!existingComment || existingComment.deletedAt) {
        return
      }

      const wasLiked = existingComment.likedByMe
      const previousComments = commentsRef.current

      setPendingLikeCommentIds((previousPendingIds) => ({
        ...previousPendingIds,
        [commentId]: true,
      }))

      const nextComments = applyRunCommentLikeState(previousComments, {
        commentId,
        delta: wasLiked ? -1 : 1,
        likedByMe: !wasLiked,
      })

      commentsRef.current = nextComments
      setComments(nextComments)

      const echoKey = getRunCommentLikeEchoKey({
        commentId,
        userId: currentUserId,
      })
      const pendingLocalLikeEchoesRef = wasLiked
        ? pendingLocalLikeDeleteEchoesRef
        : pendingLocalLikeInsertEchoesRef

      pendingLocalLikeEchoesRef.current.add(echoKey)

      try {
        const { error } = await toggleRunCommentLike(commentId, wasLiked)

        if (error) {
          throw error
        }
      } catch {
        pendingLocalLikeEchoesRef.current.delete(echoKey)
        commentsRef.current = previousComments
        setComments(previousComments)
      } finally {
        setPendingLikeCommentIds((previousPendingIds) => {
          const nextPendingIds = { ...previousPendingIds }
          delete nextPendingIds[commentId]
          return nextPendingIds
        })
      }
    },
    [currentUserId, onAuthRequired, pendingLikeCommentIds]
  )

  return {
    comments,
    pendingLikeCommentIds,
    replaceComments,
    createComment,
    editComment,
    deleteComment,
    toggleLikeComment,
  }
}
