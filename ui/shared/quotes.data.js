// Quote object shape:
// {
//   text: string,           // The quote itself, clear and self-explanatory
//   author?: string,        // Required for all gen quotes
//   id: string,             // Stable kebab-case slug (e.g., 'gen-m-1', 'yt-a-2'); never reuse or rename
//   timeOfDay: string,      // 'morning' | 'afternoon' | 'evening' | 'night'
//   site?: string,          // Optional; substring matched against blocked site (e.g., 'youtube', 'reddit')
//   signature?: true,       // Optional; user's personal quotes, 10% draw chance
//   source?: string,        // URL where the quote can be verified (required for general quotes) — must contain the actual quote text
//   philosophySource?: string, // URL to author's work/philosophy for deeper exploration (optional)
// }
//
// Time ranges (local hour):
//   morning   6–10
//   afternoon 11–16
//   evening   17–22
//   night     23–5

// ─── GENERAL ────────────────────────────────────────────────────────────────

export const QUOTES = [

  // Morning
  { text: "Every morning, when we wake up, we have twenty-four brand-new hours to live. What a precious gift!", author: "Thich Nhat Hanh", id: 'gen-m-9', timeOfDay: 'morning', source: 'https://archive.org/stream/PeaceIsEveryStep-ThichNhatHanh/ThichTextNew_djvu.txt', philosophySource: 'https://plumvillage.org/about/thich-nhat-hanh/' },
  { text: "The morning is wiser than the evening.", author: "Russian proverb", id: 'gen-m-1', timeOfDay: 'morning', source: 'https://en.wikisource.org/wiki/Russian_Folk-Tales/Vasil%C3%ADsa_the_Fair', philosophySource: 'https://en.wikipedia.org/wiki/Russian_proverbs' },
  { text: "Morning is wonderful. Its only drawback is that it comes at such an inconvenient time of day.", author: "Glen Cook", id: 'gen-m-4', timeOfDay: 'morning', source: 'https://en.wikiquote.org/wiki/Glen_Cook', philosophySource: 'https://en.wikipedia.org/wiki/Glen_Cook' },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb", id: 'gen-m-6', timeOfDay: 'morning', source: 'https://en.wiktionary.org/wiki/%E4%B8%83%E8%BB%A2%E3%81%B3%E5%85%AB%E8%B5%B7%E3%81%8D', philosophySource: 'https://en.wikipedia.org/wiki/Japanese_proverbs' },
  { text: "Talk to yourself like someone you love.", author: "Brené Brown", id: 'gen-m-7', timeOfDay: 'morning', source: 'https://brenebrown.com/book/the-gifts-of-imperfection/', philosophySource: 'https://www.brenebrown.com/' },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott", id: 'gen-m-8', timeOfDay: 'morning', source: 'https://www.salon.com/2015/04/10/anne_lamott_shares_all_that_she_knows_everyone_is_screwed_up_broken_clingy_and_scared/', philosophySource: 'https://en.wikipedia.org/wiki/Anne_Lamott' },

  // Afternoon
  { text: "Little by little fills up the measure.", author: "Swahili proverb", id: 'gen-a-5', timeOfDay: 'afternoon', source: 'https://swahiliproverbs.afrst.illinois.edu/proverbs.htm', philosophySource: 'https://en.wikipedia.org/wiki/Swahili_people' },
  { text: "A change is as good as a rest.", author: "English proverb", id: 'gen-a-13', timeOfDay: 'afternoon', source: 'https://www.phrases.org.uk/meanings/a-change-is-as-good-as-a-rest.html', philosophySource: 'https://en.wikipedia.org/wiki/Proverb' },
  { text: "I loafe and invite my soul, I lean and loafe at my ease observing a spear of summer grass.", author: "Walt Whitman", id: 'gen-a-15', timeOfDay: 'afternoon', source: 'https://en.wikisource.org/wiki/Leaves_of_Grass_(1882)/Song_of_Myself', philosophySource: 'https://en.wikipedia.org/wiki/Walt_Whitman' },
  { text: "Time has fallen asleep in the afternoon sunshine.", author: "Alexander Smith", id: 'gen-a-16', timeOfDay: 'afternoon', source: 'https://archive.org/stream/dreamthorpbookof00smituoft/dreamthorpbookof00smituoft_djvu.txt', philosophySource: 'https://en.wikipedia.org/wiki/Alexander_Smith_(poet)' },
  { text: "It is possible to live happily in the here and the now. So many conditions of happiness are available — more than enough for you to be happy right now.", author: "Thich Nhat Hanh", id: 'gen-a-17', timeOfDay: 'afternoon', source: 'https://plumvillage.org/about/thich-nhat-hanh/interviews-with-thich-nhat-hanh/oprah-talks-to-thich-nhat-hanh', philosophySource: 'https://plumvillage.org/about/thich-nhat-hanh/' },
  { text: "Paying attention acknowledges that we have something to learn from intelligences other than our own.", author: "Robin Wall Kimmerer", id: 'gen-a-18', timeOfDay: 'afternoon', source: 'https://en.wikiquote.org/wiki/Robin_Wall_Kimmerer', philosophySource: 'https://en.wikipedia.org/wiki/Robin_Wall_Kimmerer' },

  // Evening
  { text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard", id: 'gen-e-1', timeOfDay: 'evening', source: 'https://www.themarginalian.org/2013/06/07/annie-dillard-the-writing-life-1/', philosophySource: 'https://en.wikipedia.org/wiki/Annie_Dillard' },
  { text: "This is a delicious evening, when the whole body is one sense, and imbibes delight through every pore.", author: "Henry David Thoreau", id: 'gen-e-10', timeOfDay: 'evening', source: 'https://en.wikisource.org/wiki/Walden_(1893)_Thoreau/Chapter_V', philosophySource: 'https://en.wikipedia.org/wiki/Henry_David_Thoreau' },
  { text: "For a moment, let go of the way you appear and the things you've done. Feel the truth and power of who you are. In silence, there is much you can know.", author: "Ralph Marston", id: 'gen-e-5', timeOfDay: 'evening', source: 'https://greatday.com/motivate/081224.html', philosophySource: 'https://greatday.com/' },
  { text: "Sometimes the most important thing in a whole day is the rest we take between two deep breaths.", author: "Etty Hillesum", id: 'gen-e-6', timeOfDay: 'evening', source: 'https://archive.org/details/aninterruptedlif0000hill', philosophySource: 'https://en.wikipedia.org/wiki/Etty_Hillesum' },
  { text: "Never get so busy making a living that you forget to make a life.", author: "Dolly Parton", id: 'gen-e-7', timeOfDay: 'evening', source: 'https://x.com/DollyParton/status/20723962228', philosophySource: 'https://www.dollyparton.com/' },
  { text: "Slow and steady wins the race.", author: "Robert Lloyd", id: 'gen-e-9', timeOfDay: 'evening', source: 'https://archive.org/details/bim_eighteenth-century_the-poems-of-robert-lloy_lloyd-robert_1774/page/196/', philosophySource: 'https://en.wikipedia.org/wiki/Robert_Lloyd_(poet)' },

  // Night
  { text: "Let us go to our sleep with joy and gladness; let us say: I have lived; the course which Fortune set for me is finished.", author: "Seneca", id: 'gen-n-8', timeOfDay: 'night', source: 'https://en.wikisource.org/wiki/Moral_letters_to_Lucilius/Letter_12', philosophySource: 'https://en.wikipedia.org/wiki/Seneca_the_Younger' },
  { text: "Something attempted, something done, has earned a night's repose.", author: "Henry Wadsworth Longfellow", id: 'gen-n-9', timeOfDay: 'night', source: 'https://poets.org/poem/village-blacksmith', philosophySource: 'https://en.wikipedia.org/wiki/Henry_Wadsworth_Longfellow' },
  { text: "Sleep is the golden chain that ties health and our bodies together.", author: "Thomas Dekker", id: 'gen-n-1', timeOfDay: 'night', source: 'https://archive.org/details/gullshornbook00mckegoog', philosophySource: 'https://en.wikipedia.org/wiki/Thomas_Dekker_(writer)' },
  { text: "A good laugh and a long sleep are the two best cures in the doctor's book.", author: "Irish proverb", id: 'gen-n-2', timeOfDay: 'night', source: 'https://cumann-na-gaeilge.org/seanfhocail/', philosophySource: 'https://en.wikipedia.org/wiki/Irish_folklore' },
  { text: "Sleep is not an optional lifestyle luxury. It is a non-negotiable biological necessity.", author: "Matthew Walker", id: 'gen-n-3', timeOfDay: 'night', source: 'https://en.wikiquote.org/wiki/Matthew_Walker_(scientist)', philosophySource: 'https://www.sleepdiplomat.com/' },
  { text: "After sixteen hours of being awake, the brain begins to fail.", author: "Matthew Walker", id: 'gen-n-6', timeOfDay: 'night', source: 'https://en.wikiquote.org/wiki/Matthew_Walker_(scientist)', philosophySource: 'https://www.sleepdiplomat.com/' },

  // ─── YOUTUBE ──────────────────────────────────────────────────────────────

  { text: "YouTube's algorithm decides what morning content you see.",                    id: 'yt-m-1', timeOfDay: 'morning',   site: 'youtube' },
  { text: "The algorithm prioritizes watch time. Morning is when it matters most.", id: 'yt-m-2', timeOfDay: 'morning', site: 'youtube' },
  { text: "YouTube's morning algorithm starts before you do.",                     id: 'yt-m-3', timeOfDay: 'morning',   site: 'youtube' },

  { text: "The suggestions keep coming. So does the choice to stop.",                      id: 'yt-a-1', timeOfDay: 'afternoon', site: 'youtube' },
  { text: "They'll post again tomorrow. You can wait.",                                    id: 'yt-a-2', timeOfDay: 'afternoon', site: 'youtube' },
  { text: "Autoplay designed the plan, not you.",                                         id: 'yt-a-3', timeOfDay: 'afternoon', site: 'youtube' },

  { text: "Just one more video has been a lie every time.",                                 id: 'yt-e-1', timeOfDay: 'evening',   site: 'youtube' },
  { text: "Comments sections exist to extend your session, not enhance it.",               id: 'yt-e-2', timeOfDay: 'evening',   site: 'youtube' },
  { text: "Tonight could be something you create instead of something you watch.",         id: 'yt-e-3', timeOfDay: 'evening',   site: 'youtube' },

  { text: "The algorithm doesn't know how late it is. You do.",                           id: 'yt-n-1', timeOfDay: 'night',     site: 'youtube' },
  { text: "Videos are infinite. Sleep is finite.",                                        id: 'yt-n-2', timeOfDay: 'night',     site: 'youtube' },
  { text: "YouTube will still have videos tomorrow. Promise.",                              id: 'yt-n-3', timeOfDay: 'night',     site: 'youtube' },

  // ─── REDDIT ───────────────────────────────────────────────────────────────

  { text: "The front page was the same yesterday. And the day before.",                    id: 'rd-m-1', timeOfDay: 'morning',   site: 'reddit' },
  { text: "Reddit's front page is the same. It will still be there later.",               id: 'rd-m-2', timeOfDay: 'morning',   site: 'reddit' },
  { text: "Reddit threads continue whether or not you're in them.",                      id: 'rd-m-3', timeOfDay: 'morning',   site: 'reddit' },

  { text: "The top comment is often not the full story.",                                 id: 'rd-a-1', timeOfDay: 'afternoon', site: 'reddit' },
  { text: "Arguments in threads rarely feel resolved.",                                  id: 'rd-a-2', timeOfDay: 'afternoon', site: 'reddit' },
  { text: "The subreddit will still be there. The afternoon won't.",                       id: 'rd-a-3', timeOfDay: 'afternoon', site: 'reddit' },

  { text: "Reddit scrolling is stimulation. Rest is different.",                          id: 'rd-e-1', timeOfDay: 'evening',   site: 'reddit' },
  { text: "Whatever drama unfolded today, there will be a recap post tomorrow.",                id: 'rd-e-2', timeOfDay: 'evening',   site: 'reddit' },
  { text: "Upvotes measure visibility, not truth.",                                      id: 'rd-e-3', timeOfDay: 'evening',   site: 'reddit' },

  { text: "Late-night Reddit is a different, worse Reddit.",                                id: 'rd-n-1', timeOfDay: 'night',     site: 'reddit' },
  { text: "The thread will be locked by morning anyway.",                                   id: 'rd-n-2', timeOfDay: 'night',     site: 'reddit' },
  { text: "The best posts are waiting for you tomorrow, rested.",                         id: 'rd-n-3', timeOfDay: 'night',     site: 'reddit' },

  // ─── TWITCH ───────────────────────────────────────────────────────────────

  { text: "Watching someone else play is watching someone else's morning.",               id: 'tw-m-1', timeOfDay: 'morning',   site: 'twitch' },
  { text: "The stream will go on without your viewer count.",                               id: 'tw-m-2', timeOfDay: 'morning',   site: 'twitch' },
  { text: "Morning streams are running their own schedule, not yours.",                   id: 'tw-m-3', timeOfDay: 'morning',   site: 'twitch' },

  { text: "The chat moves faster than any conversation.",                                 id: 'tw-a-1', timeOfDay: 'afternoon', site: 'twitch' },
  { text: "The stream continues whether or not you're watching it.",                      id: 'tw-a-2', timeOfDay: 'afternoon', site: 'twitch' },
  { text: "Watching streams is time on someone else's schedule.",                         id: 'tw-a-3', timeOfDay: 'afternoon', site: 'twitch' },

  { text: "The stream will be archived. The moments you could be having won't be.",        id: 'tw-e-1', timeOfDay: 'evening',   site: 'twitch' },
  { text: "The highlights will be there to watch tomorrow.",                              id: 'tw-e-2', timeOfDay: 'evening',   site: 'twitch' },
  { text: "Watching someone else have fun is a different activity than having fun.",      id: 'tw-e-3', timeOfDay: 'evening',   site: 'twitch' },

  { text: "The streamer's schedule is not your schedule.",                                id: 'tw-n-1', timeOfDay: 'night',     site: 'twitch' },
  { text: "Late-night streams are designed to extend into the early morning.",           id: 'tw-n-2', timeOfDay: 'night',     site: 'twitch' },
  { text: "The hype train will leave the station whether or not you board it.",           id: 'tw-n-3', timeOfDay: 'night',     site: 'twitch' },

  // ─── TIKTOK ───────────────────────────────────────────────────────────────

  { text: "TikTok knows what keeps you watching. It's not what you think.",              id: 'tt-m-1', timeOfDay: 'morning',   site: 'tiktok' },
  { text: "TikTok's algorithm learns faster than you wake up.",                         id: 'tt-m-2', timeOfDay: 'morning',   site: 'tiktok' },
  { text: "The scroll spiral is the designed feature, not a side effect.",               id: 'tt-m-3', timeOfDay: 'morning',   site: 'tiktok' },

  { text: "Each video is short. The session is not.",                                       id: 'tt-a-1', timeOfDay: 'afternoon', site: 'tiktok' },
  { text: "The algorithm has no stopping point. It's designed to continue.",              id: 'tt-a-2', timeOfDay: 'afternoon', site: 'tiktok' },
  { text: "Fifteen seconds at a time is still time.",                                       id: 'tt-a-3', timeOfDay: 'afternoon', site: 'tiktok' },

  { text: "TikTok's content never runs out. That's the whole point.",                    id: 'tt-e-1', timeOfDay: 'evening',   site: 'tiktok' },
  { text: "There is no last video.",                                                      id: 'tt-e-2', timeOfDay: 'evening',   site: 'tiktok' },
  { text: "Infinite scroll has no finish line by design.",                                  id: 'tt-e-3', timeOfDay: 'evening',   site: 'tiktok' },

  { text: "TikTok at night shows you what keeps you awake the longest.",                 id: 'tt-n-1', timeOfDay: 'night',     site: 'tiktok' },
  { text: "Night scrolling is stimulation disguised as relaxation.",                   id: 'tt-n-2', timeOfDay: 'night',     site: 'tiktok' },
  { text: "This limit exists because nights like this are easy to lose.",                  id: 'tt-n-3', timeOfDay: 'night',     site: 'tiktok' },

  // ─── TWITTER / X ──────────────────────────────────────────────────────────

  { text: "The discourse started without you and will end without you.",                   id: 'x-m-1', timeOfDay: 'morning',   site: 'twitter' },
  { text: "Hot takes at breakfast time are designed for engagement, not truth.",           id: 'x-m-2', timeOfDay: 'morning',   site: 'twitter' },
  { text: "What's trending at breakfast time can wait until after breakfast.",             id: 'x-m-3', timeOfDay: 'morning',   site: 'twitter' },

  { text: "The ratio will resolve itself without your involvement.",                        id: 'x-a-1', timeOfDay: 'afternoon', site: 'twitter' },
  { text: "The debates on the timeline will continue without your input.",                 id: 'x-a-2', timeOfDay: 'afternoon', site: 'twitter' },
  { text: "Chronological or algorithmic, neither timeline is worth this.",                id: 'x-a-3', timeOfDay: 'afternoon', site: 'twitter' },

  { text: "Evening Twitter is just morning Twitter with more typos.",                       id: 'x-e-1', timeOfDay: 'evening',   site: 'twitter' },
  { text: "The hot take will still be hot tomorrow.",                                       id: 'x-e-2', timeOfDay: 'evening',   site: 'twitter' },
  { text: "Doomscrolling is a description, not a recommendation.",                         id: 'x-e-3', timeOfDay: 'evening',   site: 'twitter' },

  { text: "Late-night posting reaches different audiences with different intent.",       id: 'x-n-1', timeOfDay: 'night',     site: 'twitter' },
  { text: "Whatever is trending at this hour will be forgotten by morning.",               id: 'x-n-2', timeOfDay: 'night',     site: 'twitter' },
  { text: "Midnight tweets reach different people than morning tweets.",                 id: 'x-n-3', timeOfDay: 'night',     site: 'twitter' },

  // ─── INSTAGRAM ────────────────────────────────────────────────────────────

  { text: "Highlight reels are curated for engagement, not authenticity.",                id: 'ig-m-1', timeOfDay: 'morning',   site: 'instagram' },
  { text: "The algorithm curated that feed for maximum engagement, not your benefit.",    id: 'ig-m-2', timeOfDay: 'morning',   site: 'instagram' },
  { text: "Stories will be there when you return from breakfast.",                        id: 'ig-m-3', timeOfDay: 'morning',   site: 'instagram' },

  { text: "Reels are TikTok with better lighting. Same spiral.",                           id: 'ig-a-1', timeOfDay: 'afternoon', site: 'instagram' },
  { text: "The posts will still be there. They don't expire.",                             id: 'ig-a-2', timeOfDay: 'afternoon', site: 'instagram' },
  { text: "The feed is designed to trigger comparison. That's the point.",                id: 'ig-a-3', timeOfDay: 'afternoon', site: 'instagram' },

  { text: "Stories vanish but the feed replaces them instantly.",                       id: 'ig-e-1', timeOfDay: 'evening',   site: 'instagram' },
  { text: "The Explore page is designed for maximum engagement, not rest.",              id: 'ig-e-2', timeOfDay: 'evening',   site: 'instagram' },
  { text: "Curated moments are designed to feel endless.",                               id: 'ig-e-3', timeOfDay: 'evening',   site: 'instagram' },

  { text: "Late-night Instagram is other people's curated lives, not connection.",       id: 'ig-n-1', timeOfDay: 'night',     site: 'instagram' },
  { text: "Instagram at night is the same feed from hours ago.",                         id: 'ig-n-2', timeOfDay: 'night',     site: 'instagram' },
  { text: "The grid will look the same tomorrow.",                                          id: 'ig-n-3', timeOfDay: 'night',     site: 'instagram' },

  // ─── FACEBOOK ─────────────────────────────────────────────────────────────

  { text: "Messages can wait until you're ready for them.",                              id: 'fb-m-1', timeOfDay: 'morning',   site: 'facebook' },
  { text: "Facebook memories are rarely a good morning surprise.",                          id: 'fb-m-2', timeOfDay: 'morning',   site: 'facebook' },
  { text: "Marketplace listings persist longer than your morning attention span.",        id: 'fb-m-3', timeOfDay: 'morning',   site: 'facebook' },

  { text: "Facebook threads are designed for engagement, not understanding.",             id: 'fb-a-1', timeOfDay: 'afternoon', site: 'facebook' },
  { text: "Event invitations have always waited until you decided.",                      id: 'fb-a-2', timeOfDay: 'afternoon', site: 'facebook' },
  { text: "The engagement bait post does not need your engagement.",                        id: 'fb-a-3', timeOfDay: 'afternoon', site: 'facebook' },

  { text: "The group drama will resolve without your input.",                               id: 'fb-e-1', timeOfDay: 'evening',   site: 'facebook' },
  { text: "Suggested posts are not suggestions. They're traps.",                           id: 'fb-e-2', timeOfDay: 'evening',   site: 'facebook' },
  { text: "Facebook posts made late are rarely reviewed with care.",                     id: 'fb-e-3', timeOfDay: 'evening',   site: 'facebook' },

  { text: "Night Facebook is just old content and older arguments.",                        id: 'fb-n-1', timeOfDay: 'night',     site: 'facebook' },
  { text: "Notifications sent at this hour are designed for insomnia, not priority.",     id: 'fb-n-2', timeOfDay: 'night',     site: 'facebook' },
  { text: "Late-night Facebook is recycled content from hours before.",                 id: 'fb-n-3', timeOfDay: 'night',     site: 'facebook' },

  // ─── AMAZON ───────────────────────────────────────────────────────────────

  { text: "Amazon's cart is designed to follow you from tab to tab.",                    id: 'az-m-1', timeOfDay: 'morning',   site: 'amazon' },
  { text: "The deal of the day will be replaced by a new deal tomorrow.",                  id: 'az-m-2', timeOfDay: 'morning',   site: 'amazon' },
  { text: "Recommendations appear before you scroll, while you scroll, and after.",        id: 'az-m-3', timeOfDay: 'morning',   site: 'amazon' },

  { text: "The reviews section is a rabbit hole with a purchase at the end.",              id: 'az-a-1', timeOfDay: 'afternoon', site: 'amazon' },
  { text: "If you need it, it'll still be available later.",                               id: 'az-a-2', timeOfDay: 'afternoon', site: 'amazon' },
  { text: "Frequently bought together is not a shopping list.",                             id: 'az-a-3', timeOfDay: 'afternoon', site: 'amazon' },

  { text: "Evening browsing is how wishlists become regrets.",                              id: 'az-e-1', timeOfDay: 'evening',   site: 'amazon' },
  { text: "Prime delivery is fast. Your decision doesn't have to be.",                    id: 'az-e-2', timeOfDay: 'evening',   site: 'amazon' },
  { text: "The recommended section is designed to extend sessions, not end them.",        id: 'az-e-3', timeOfDay: 'evening',   site: 'amazon' },

  { text: "Late-night Amazon is just one-click away from regret.",                       id: 'az-n-1', timeOfDay: 'night',     site: 'amazon' },
  { text: "Sleep on it. Literally.",                                                        id: 'az-n-2', timeOfDay: 'night',     site: 'amazon' },
  { text: "One-click ordering at midnight is not a superpower.",                            id: 'az-n-3', timeOfDay: 'night',     site: 'amazon' },

  // ─── SHOPPING (catch-all) ─────────────────────────────────────────────────

  { text: "Morning shopping platforms show inventory, not necessity.",                    id: 'sh-m-1', timeOfDay: 'morning',   site: 'shop' },
  { text: "The item will still be listed after you've had breakfast.",                     id: 'sh-m-2', timeOfDay: 'morning',   site: 'shop' },
  { text: "Want and need are different words for a reason.",                                id: 'sh-m-3', timeOfDay: 'morning',   site: 'shop' },

  { text: "If you've been browsing long enough to hit a limit, you're not shopping. You're scrolling.", id: 'sh-a-1', timeOfDay: 'afternoon', site: 'shop' },
  { text: "The sale ends when it ends. Your afternoon ends at midnight.",                   id: 'sh-a-2', timeOfDay: 'afternoon', site: 'shop' },
  { text: "Add to cart is not the same as buy. Give it a day.",                            id: 'sh-a-3', timeOfDay: 'afternoon', site: 'shop' },

  { text: "Evening browsing has a way of becoming morning regret.",                         id: 'sh-e-1', timeOfDay: 'evening',   site: 'shop' },
  { text: "The checkout button will still work tomorrow.",                                   id: 'sh-e-2', timeOfDay: 'evening',   site: 'shop' },
  { text: "Window shopping online is still shopping.",                                      id: 'sh-e-3', timeOfDay: 'evening',   site: 'shop' },

  { text: "Midnight purchases are a category of their own.",                                id: 'sh-n-1', timeOfDay: 'night',     site: 'shop' },
  { text: "Sleep is free. Shopping is not.",                                              id: 'sh-n-2', timeOfDay: 'night',     site: 'shop' },
  { text: "The listing will still be there in the morning. You'll see it differently.",    id: 'sh-n-3', timeOfDay: 'night',     site: 'shop' },

  // ─── LINKEDIN ─────────────────────────────────────────────────────────────

  { text: "Hustle culture content before 9am is not inspiration. It's pressure.",          id: 'li-m-1', timeOfDay: 'morning',   site: 'linkedin' },
  { text: "The job listing will still be open after breakfast.",                            id: 'li-m-2', timeOfDay: 'morning',   site: 'linkedin' },
  { text: "No one's career update needed your reaction this early.",                       id: 'li-m-3', timeOfDay: 'morning',   site: 'linkedin' },

  { text: "Thought leadership can wait. You have actual work.",                             id: 'li-a-1', timeOfDay: 'afternoon', site: 'linkedin' },
  { text: "The connection request is not urgent.",                                           id: 'li-a-2', timeOfDay: 'afternoon', site: 'linkedin' },
  { text: "Comparing careers mid-afternoon helps no one, especially yours.",               id: 'li-a-3', timeOfDay: 'afternoon', site: 'linkedin' },

  { text: "After-hours LinkedIn is just work anxiety with a feed.",                         id: 'li-e-1', timeOfDay: 'evening',   site: 'linkedin' },
  { text: "The viral post about someone's overnight success took years.",                  id: 'li-e-2', timeOfDay: 'evening',   site: 'linkedin' },
  { text: "You are more than your profile. Step away from it.",                            id: 'li-e-3', timeOfDay: 'evening',   site: 'linkedin' },

  { text: "Midnight job searching is a specific kind of spiral.",                           id: 'li-n-1', timeOfDay: 'night',     site: 'linkedin' },
  { text: "No recruiter is reading your profile right now. Rest.",                         id: 'li-n-2', timeOfDay: 'night',     site: 'linkedin' },
  { text: "The inspirational post will be just as hollow in the morning.",                 id: 'li-n-3', timeOfDay: 'night',     site: 'linkedin' },

  // ─── NEWS (catch-all) ─────────────────────────────────────────────────────────────────

  { text: "The headlines were written to alarm you. Don't let them.",                      id: 'nw-m-1', timeOfDay: 'morning',   site: 'news' },
  { text: "Informed is good. Saturated before 9am is something else.",                     id: 'nw-m-2', timeOfDay: 'morning',   site: 'news' },
  { text: "The world will still be turning after breakfast.",                               id: 'nw-m-3', timeOfDay: 'morning',   site: 'news' },

  { text: "Refreshing the news does not change the news.",                                  id: 'nw-a-1', timeOfDay: 'afternoon', site: 'news' },
  { text: "You are already informed enough to have an opinion. You don't need more.",      id: 'nw-a-2', timeOfDay: 'afternoon', site: 'news' },
  { text: "Breaking news rarely is.",                                                       id: 'nw-a-3', timeOfDay: 'afternoon', site: 'news' },

  { text: "The evening news cycle is designed to keep you anxious and clicking.",          id: 'nw-e-1', timeOfDay: 'evening',   site: 'news' },
  { text: "You've read enough today. The news will summarise itself by morning.",          id: 'nw-e-2', timeOfDay: 'evening',   site: 'news' },
  { text: "Being informed is a virtue. Being saturated is a habit.",                       id: 'nw-e-3', timeOfDay: 'evening',   site: 'news' },

  { text: "Nothing in the news requires your attention at this hour.",                      id: 'nw-n-1', timeOfDay: 'night',     site: 'news' },
  { text: "The story will still be developing tomorrow. So will you.",                     id: 'nw-n-2', timeOfDay: 'night',     site: 'news' },
  { text: "News algorithms prioritize urgency. Night is when urgency peaks.",             id: 'nw-n-3', timeOfDay: 'night',     site: 'news' },

  // ─── CHATGPT ──────────────────────────────────────────────────────────────

  { text: "You're asking an AI for help. It's working. The question is: are you?",      id: 'cg-m-1', timeOfDay: 'morning',   site: 'chatgpt' },
  { text: "The prompt can wait. So can the answer.",                                        id: 'cg-m-2', timeOfDay: 'morning',   site: 'chatgpt' },
  { text: "Some mornings the most productive thing is to think for yourself first.",       id: 'cg-m-3', timeOfDay: 'morning',   site: 'chatgpt' },

  { text: "AI assistants can become procrastination tools if you let them.",              id: 'cg-a-1', timeOfDay: 'afternoon', site: 'chatgpt' },
  { text: "The conversation will still be in your history when you return.",               id: 'cg-a-2', timeOfDay: 'afternoon', site: 'chatgpt' },
  { text: "Even AI tools can become avoidance tools.",                                      id: 'cg-a-3', timeOfDay: 'afternoon', site: 'chatgpt' },

  { text: "You've used your AI time for today. Trust your own brain for the rest.",        id: 'cg-e-1', timeOfDay: 'evening',   site: 'chatgpt' },
  { text: "Late prompts are usually abandoned by morning.",                        id: 'cg-e-2', timeOfDay: 'evening',   site: 'chatgpt' },
  { text: "Some problems are better slept on than prompted on.",                            id: 'cg-e-3', timeOfDay: 'evening',   site: 'chatgpt' },

  { text: "The AI doesn't need sleep. You do.",                                             id: 'cg-n-1', timeOfDay: 'night',     site: 'chatgpt' },
  { text: "Midnight AI conversations have a way of going nowhere slowly.",                 id: 'cg-n-2', timeOfDay: 'night',     site: 'chatgpt' },
  { text: "Late-night AI use extends thinking instead of resolving it.",                 id: 'cg-n-3', timeOfDay: 'night',     site: 'chatgpt' },

  // ─── GEMINI ───────────────────────────────────────────────────────────────

  { text: "You asked an AI to help you. Consider this it helping.",                  id: 'gm-m-1', timeOfDay: 'morning',   site: 'gemini' },
  { text: "The model will still be there. Your morning window won't.",                     id: 'gm-m-2', timeOfDay: 'morning',   site: 'gemini' },
  { text: "Some questions are worth sitting with before asking an AI.",                    id: 'gm-m-3', timeOfDay: 'morning',   site: 'gemini' },

  { text: "Even helpful tools can fill time that could be thought.",                        id: 'gm-a-1', timeOfDay: 'afternoon', site: 'gemini' },
  { text: "The response will be just as good in an hour.",                                  id: 'gm-a-2', timeOfDay: 'afternoon', site: 'gemini' },
  { text: "You blocked an AI. That's a very 21st century problem to have.",               id: 'gm-a-3', timeOfDay: 'afternoon', site: 'gemini' },

  { text: "You've queried enough for today. Rest the prompts.",                             id: 'gm-e-1', timeOfDay: 'evening',   site: 'gemini' },
  { text: "The answer you're looking for might not be in a language model.",               id: 'gm-e-2', timeOfDay: 'evening',   site: 'gemini' },
  { text: "Some evenings the best output is no output.",                                    id: 'gm-e-3', timeOfDay: 'evening',   site: 'gemini' },

  { text: "The model runs on servers that don't need sleep. You do.",                      id: 'gm-n-1', timeOfDay: 'night',     site: 'gemini' },
  { text: "No insight generated after midnight is worth the lost sleep.",                  id: 'gm-n-2', timeOfDay: 'night',     site: 'gemini' },
  { text: "Close the tab. The answers will still be generatable tomorrow.",                id: 'gm-n-3', timeOfDay: 'night',     site: 'gemini' },

  // ─── SIGNATURE ────────────────────────────────────────────────────────────
  // Plushy quotes. 10% draw chance.

  // ─── PWETPWET ─────────────────────────────────────────────────────────────

  { text: "I bit your screen so you would look up. You're welcome.",         author: "PwetPwet 🦈", id: 'sig-m-1', timeOfDay: 'morning',   signature: true },
  { text: "Good morning. I am watching.",                                    author: "PwetPwet 🦈", id: 'sig-m-2', timeOfDay: 'morning',   signature: true },
  { text: "I have been assigned to this tab. I take my assignments seriously.", author: "PwetPwet 🦈", id: 'sig-m-3', timeOfDay: 'morning',   signature: true },
  { text: "Do not let my size fool you. I am extremely in charge.",         author: "PwetPwet 🦈", id: 'sig-m-4', timeOfDay: 'morning',   signature: true },
  { text: "I patrol these waters so you don't have to.",                    author: "PwetPwet 🦈", id: 'sig-m-5', timeOfDay: 'morning',   signature: true },

  { text: "I have bitten the internet on your behalf. Rest now.",       author: "PwetPwet 🦈", id: 'sig-a-1', timeOfDay: 'afternoon', signature: true },
  { text: "You were doing so well. Then I had to bite.",                author: "PwetPwet 🦈", id: 'sig-a-2', timeOfDay: 'afternoon', signature: true },
  { text: "A shark's gotta do what a shark's gotta do.",               author: "PwetPwet 🦈", id: 'sig-a-3', timeOfDay: 'afternoon', signature: true },
  { text: "Halfway through the day. Time for a break. I have decided.", author: "PwetPwet 🦈", id: 'sig-a-4', timeOfDay: 'afternoon', signature: true },
  { text: "I am very small. My concern for you is very large.",         author: "PwetPwet 🦈", id: 'sig-a-5', timeOfDay: 'afternoon', signature: true },
  { text: "Even sharks rest between swims.",                            author: "PwetPwet 🦈", id: 'sig-a-6', timeOfDay: 'afternoon', signature: true },

  { text: "The day is almost done. So is your screen time. Good job to both of us.", author: "PwetPwet 🦈", id: 'sig-e-5', timeOfDay: 'evening',   signature: true },
  { text: "I did a very small bite. It was very effective.",            author: "PwetPwet 🦈", id: 'sig-e-1', timeOfDay: 'evening',   signature: true },
  { text: "Small shark. Big responsibility. Evening off.",               author: "PwetPwet 🦈", id: 'sig-e-3', timeOfDay: 'evening',   signature: true },
  { text: "The biting is done. PwetPwet rests.",                        author: "PwetPwet 🦈", id: 'sig-e-4', timeOfDay: 'evening',   signature: true },
  { text: "Screens are for daytime. I have decided.",                   author: "PwetPwet 🦈", id: 'sig-e-2', timeOfDay: 'evening',   signature: true },

  { text: "I bite screens so you can dream. That is my purpose.",              author: "PwetPwet 🦈", id: 'sig-n-1', timeOfDay: 'night',     signature: true },
  { text: "It is very late. Even I am sleepy. Please go to bed.",             author: "PwetPwet 🦈", id: 'sig-n-2', timeOfDay: 'night',     signature: true },
  { text: "The ocean is still there when you come back. So is the internet.", author: "PwetPwet 🦈", id: 'sig-n-3', timeOfDay: 'night',     signature: true },
  { text: "The deep-sleep ocean is soft and quiet. You should try it.",              author: "PwetPwet 🦈", id: 'sig-n-4', timeOfDay: 'night',     signature: true },
  { text: "The tide goes out. The screen goes dark. That is the natural order.", author: "PwetPwet 🦈", id: 'sig-n-5', timeOfDay: 'night',     signature: true },
  { text: "PwetPwet does not sleep. But you should. One of us has to.",          author: "PwetPwet 🦈", id: 'sig-n-6', timeOfDay: 'night',     signature: true },
  { text: "Night shift: complete. Your shift is also complete.",                  author: "PwetPwet 🦈", id: 'sig-n-7', timeOfDay: 'night',     signature: true },
  { text: "What do you call this ocean again... I know! Bed!!",                    author: "PwetPwet 🦈", id: 'sig-n-8', timeOfDay: 'night',     signature: true },

  // ─── TOOT ─────────────────────────────────────────────────────────────────

  { text: "The fox wakes before the forest stirs.",                               author: "Toot 🦊", id: 'sig-toot-m-1', timeOfDay: 'morning',   signature: true },
  { text: "Toot has arrived. The destination is not here.",                       author: "Toot 🦊", id: 'sig-toot-m-2', timeOfDay: 'morning',   signature: true },
  { text: "Growth happens in the gaps. This is a gap.",                           author: "Toot 🦊", id: 'sig-toot-m-3', timeOfDay: 'morning',   signature: true },
  { text: "The forest is wide awake. You could be too.",                          author: "Toot 🦊", id: 'sig-toot-m-4', timeOfDay: 'morning',   signature: true },

  { text: "Not all wandering is lost. But this tab was.",                         author: "Toot 🦊", id: 'sig-toot-a-1', timeOfDay: 'afternoon', signature: true },
  { text: "Toot knows a better place. Come along.",                               author: "Toot 🦊", id: 'sig-toot-a-2', timeOfDay: 'afternoon', signature: true },
  { text: "Toot has seen this stop before. It is not the destination.",           author: "Toot 🦊", id: 'sig-toot-a-3', timeOfDay: 'afternoon', signature: true },
  { text: "You have been circling the same clearing for a while now.",            author: "Toot 🦊", id: 'sig-toot-a-4', timeOfDay: 'afternoon', signature: true },
  { text: "The internet is a very loud forest. Step out for a moment.",           author: "Toot 🦊", id: 'sig-toot-a-5', timeOfDay: 'afternoon', signature: true },

  { text: "Sit with the quiet for a moment. It will not bite.",                   author: "Toot 🦊", id: 'sig-toot-e-1', timeOfDay: 'evening',   signature: true },
  { text: "Next stop: somewhere quieter.",                                         author: "Toot 🦊", id: 'sig-toot-e-2', timeOfDay: 'evening',   signature: true },
  { text: "Silence is not empty. Try to hear it.",                                author: "Toot 🦊", id: 'sig-toot-e-3', timeOfDay: 'evening',   signature: true },
  { text: "The forest dims. I dim the lights.",                               author: "Toot 🦊", id: 'sig-toot-e-4', timeOfDay: 'evening',   signature: true },

  { text: "Every journey needs a rest stop. This is yours.",                      author: "Toot 🦊", id: 'sig-toot-n-1', timeOfDay: 'night',     signature: true },
  { text: "End of the line. Please collect your thoughts and exit.",              author: "Toot 🦊", id: 'sig-toot-n-2', timeOfDay: 'night',     signature: true },
  { text: "The mind wanders so the body can stay.",                               author: "Toot 🦊", id: 'sig-toot-n-3', timeOfDay: 'night',     signature: true },
  { text: "What you carry into sleep, you carry into tomorrow.",                  author: "Toot 🦊", id: 'sig-toot-n-4', timeOfDay: 'night',     signature: true },
  { text: "Even Toot parks the bus eventually.",                                  author: "Toot 🦊", id: 'sig-toot-n-5', timeOfDay: 'night',     signature: true },

];
