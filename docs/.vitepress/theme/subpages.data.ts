import { createContentLoader } from 'vitepress'

// Usa un array: prendi tutti i .md ma escludi qualsiasi file si chiami index.md
export default createContentLoader(['**/*.md', '!**/index.md'], {
  includeSrc: false,
  render: false,
  transform(raw) {
    return raw.map(({ url, frontmatter }) => ({
      title: frontmatter.title || (url?.split('/')?.pop()?.replace('.html', '') ?? ""),
      url,
      frontmatter
    }))
  }
})