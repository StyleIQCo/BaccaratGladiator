-- Atomic, idempotent debit: balance floor and idempotency guard checked
-- in one script so a replayed PLACE_BET can never double-debit and a
-- concurrent pair can never overdraw.
-- KEYS[1] = bal:{userId}
-- KEYS[2] = settled:{idemKey}   (idempotency set, member = userId)
-- ARGV[1] = amount (positive integer)
-- ARGV[2] = userId
-- Returns { 1=applied | 2=duplicate(no-op) | 0=insufficient, balance-as-string }
if redis.call('SISMEMBER', KEYS[2], ARGV[2]) == 1 then
  return { 2, tostring(redis.call('GET', KEYS[1]) or '0') }
end
local bal = tonumber(redis.call('GET', KEYS[1]) or '0')
local amt = tonumber(ARGV[1])
if bal < amt then
  return { 0, tostring(bal) }
end
redis.call('SADD', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[2], 86400)
return { 1, tostring(redis.call('DECRBY', KEYS[1], amt)) }
