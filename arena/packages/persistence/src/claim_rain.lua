-- Atomic first-N rain claim. Redis is single-threaded, so this whole script runs
-- with no interleaving — the ONLY place the "first 50 win" decision is made.
-- KEYS[1] = rain:<id>:claims (SET of winning userIds)
-- ARGV[1] = userId   ARGV[2] = maxClaims   ARGV[3] = perUserChips
-- Returns: { granted(0|1), rank, amount }
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
  return {0, 0, 0}                                  -- already claimed (idempotent)
end
local count = redis.call('SCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then
  return {0, 0, 0}                                  -- window full — too slow
end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], 120000)             -- self-clean after 2 min
return {1, count + 1, tonumber(ARGV[3])}           -- winner; SADD guarantees uniqueness
