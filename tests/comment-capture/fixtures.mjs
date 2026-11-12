export function discussionFixture(url, { rootCount = 80, replyRoots = 20, repliesPerRoot = 3 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const sizes = [rootCount + Math.min(rootCount, replyRoots) * repliesPerRoot, 3, 2, 1, 2, 4];
  const posts = sizes.map((size, index) => ({
    id: `fixture${index}`,
    url,
    title: "A shared article",
    author: "fixture_author",
    subreddit: `community${index}`,
    subreddit_name_prefixed: `r/community${index}`,
    permalink: `/r/community${index}/comments/fixture${index}/article/`,
    num_comments: index === 0 ? 2156 : size,
    created_utc: now - 3600 - index,
    score: 100 - index,
  }));

  const comment = (id, post, parentId, body, replies = "", author = "reader") => ({
    kind: "t1",
    data: { id, body, author, parent_id: parentId, link_id: `t3_${post.id}`, created_utc: now - 600, score: 10, replies },
  });

  const roots = Array.from({ length: rootCount }, (_, index) => {
    const id = `root${index}`;
    const children = index < replyRoots
      ? Array.from({ length: repliesPerRoot }, (_, child) => comment(`reply${index}x${child}`, posts[0], `t1_${id}`, `Reply ${index}:${child}`))
      : [];
    const replies = children.length ? { kind: "Listing", data: { children } } : "";
    return comment(id, posts[0], `t3_${posts[0].id}`, `Root comment ${index}`, replies, index === 0 ? "[deleted]" : "reader");
  });
  const trees = new Map([[posts[0].id, roots]]);
  for (let index = 1; index < posts.length; index++) {
    trees.set(posts[index].id, Array.from({ length: sizes[index] }, (_, child) =>
      comment(`aux${index}x${child}`, posts[index], `t3_${posts[index].id}`, `Community ${index} comment ${child}`),
    ));
  }
  const flatten = (nodes) => nodes.flatMap((node) => [
    node.data,
    ...flatten(node.data.replies?.data?.children || []),
  ]);
  const responses = [
    { match: (url) => url.includes("/api/posts/search"), json: { data: posts } },
    ...posts.map((post) => ({
      match: (url) => url.includes("/api/comments/tree") && new URL(url).searchParams.get("link_id") === `t3_${post.id}`,
      json: { data: trees.get(post.id) },
    })),
    ...posts.map((post) => ({
      match: (url) => url.includes("/api/comments/search") && new URL(url).searchParams.get("link_id") === post.id,
      json: { data: flatten(trees.get(post.id)).slice(0, 100) },
    })),
  ];
  return { posts, sizes, trees, responses };
}
