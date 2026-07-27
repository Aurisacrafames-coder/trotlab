import type { NextFunction, Request, Response } from 'express';

/** Enkel lösenordsskydd för publik hosting (ACCESS_PASSWORD). */
export function accessGate(req: Request, res: Response, next: NextFunction) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return next();

  const user = process.env.ACCESS_USER ?? 'trotlab';
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon >= 0) {
      const u = decoded.slice(0, colon);
      const p = decoded.slice(colon + 1);
      if (u === user && p === password) return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="TrotLab"');
  res.status(401).send('Logga in för att använda TrotLab');
}
