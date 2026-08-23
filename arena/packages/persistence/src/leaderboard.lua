-- Atomic leaderboard bump. ZINCRBY + before/after ZREVRANK in one script
-- so two gateways can never disagree about whether a rank changed.
-- KEYS[1] = bracket zset  (lb:{seasonKey}:t{tier})
-- ARGV[1] = userId
-- ARGV[2] = delta (positive integer chips)
-- Returns { beforeRank0 | -1, afterRank0, score-as-string }  (0-based ranks)
local before = redis.call('ZREVRANK', KEYS[1], ARGV[1])
local score  = redis.call('ZINCRBY', KEYS[1], ARGV[2], ARGV[1])
local after  = redis.call('ZREVRANK', KEYS[1], ARGV[1])
if before == false then before = -1 end
return { before, after, tostring(score) }
