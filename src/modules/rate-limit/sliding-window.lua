-- Atomic sliding-window rate-limit check + increment.
--
-- KEYS[1]  = sorted set key (e.g. ratelimit:{tenantId}:{provider}:rpm)
-- ARGV[1]  = now in Unix milliseconds (string)
-- ARGV[2]  = window size in milliseconds (e.g. 60000 for RPM)
-- ARGV[3]  = max requests allowed within the window (limit)
-- ARGV[4]  = unique member for this request (now + random suffix)
--
-- Returns:
--   {1, remaining}  when the request is allowed (remaining = slots left after this one)
--   {0, 0}          when the request is rejected (limit already reached)

local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

-- Remove entries that have fallen outside the sliding window.
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)

-- Count requests currently inside the window.
local count = redis.call('ZCARD', KEYS[1])

if count < limit then
  -- Register this request at the current timestamp.
  redis.call('ZADD', KEYS[1], now, member)
  -- Keep the key alive for at least one full window so ZREMRANGEBYSCORE
  -- can clean it up; +1 guards against sub-second rounding.
  redis.call('EXPIRE', KEYS[1], math.ceil(window / 1000) + 1)
  return {1, limit - count - 1}
else
  return {0, 0}
end
