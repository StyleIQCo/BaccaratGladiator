// ═══════════════════════════════════════════════════════════════════
//  AUTH BRIDGE — resolves the calling player from the request.
//
//  SECURITY INVARIANT: reward endpoints must NEVER accept a userId in
//  the request body. The referee identity for /api/referrals/validate
//  comes exclusively from the verified session, otherwise anyone could
//  replay other players' referrals and farm bounties.
//
//  The arena identifies players via Cognito (User.cognitoSub). Wire
//  this to the real session mechanism: verify the Cognito JWT from the
//  Authorization header (aws-jwt-verify), then map sub → User.id.
// ═══════════════════════════════════════════════════════════════════
import { prisma } from './db';

export async function getSessionUserId(req: Request): Promise<string | null> {
  // TODO(auth): replace with real Cognito JWT verification:
  //   const payload = await cognitoVerifier.verify(bearerToken);
  //   const user = await prisma.user.findUnique({ where: { cognitoSub: payload.sub } });
  //   return user?.id ?? null;

  if (process.env.NODE_ENV !== 'production') {
    // Dev escape hatch so the flow is testable before Cognito is wired.
    const devUserId = req.headers.get('x-dev-user-id');
    if (devUserId) {
      const user = await prisma.user.findUnique({ where: { id: devUserId }, select: { id: true } });
      return user?.id ?? null;
    }
  }

  return null; // unauthenticated until the Cognito bridge is wired
}
