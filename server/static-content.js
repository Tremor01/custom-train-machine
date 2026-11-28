import path from 'node:path';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export function isPathInside(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  return relative !== '' && !paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`);
}

export function staticContentType(path) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return contentTypes[extension] || 'application/octet-stream';
}
