import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { DID_ADDITIONS, DID_REMOVALS } from './membership'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent, ciqueersky) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    // This logs the text of every post off the firehose.
    // Just for fun :)
    // Delete before actually using
    for (const post of ops.posts.creates) {
      console.log(post.record.text)
    }

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate = ops.posts.creates
      .filter((create) => {
        // Filter for posts that include our accepted hashtags
        let hashtags: any[] = []
        create?.record?.text?.toLowerCase()
          ?.match(/#[^\s#\.\;]*/gmi)
          ?.map((hashtag) => {
            hashtags.push(hashtag)
          })

        // Process new signups for our feed.
        if (hashtags.includes('#JoinCIQueer') && !DID_REMOVALS.includes(create.author) && !DID_ADDITIONS.includes(create.author)) {
          DID_ADDITIONS.push(create.author)
        }

        // Process removals from our feed
        if (hashtags.includes('#LeaveCIQueer')) {
          const index = DID_ADDITIONS.indexOf(create.author, 0)
          if (index > -1) {
            DID_ADDITIONS.splice(index, 1)
          }
        }

        let isCiQueerskyAuthor = ciqueersky.has(create.author)

        return isCiQueerskyAuthor || hashtags.includes('#CIQueer')
      })
      .map((create) => {
        // Create CIQueersky posts in db
        return {
          uri: create.uri,
          cid: create.cid,
          replyParent: create.record?.reply?.parent.uri ?? null,
          replyRoot: create.record?.reply?.root.uri ?? null,
          indexedAt: new Date().toISOString(),
        }
      })

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
