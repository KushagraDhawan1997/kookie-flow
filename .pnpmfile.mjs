/** Local source conditions must never point consumers at files omitted from the tarball. */
export const hooks = {
  beforePacking(pkg) {
    // Any scope: this file is shared with the source repository, whose packages live under another one.
    if (!/^@[^/]+\/kookie-flow(-|$)/.test(pkg.name ?? '')) return pkg;
    for (const value of Object.values(pkg.exports ?? {})) {
      if (value && typeof value === 'object') delete value['kookie-flow-source'];
    }
    delete pkg.devDependencies;
    delete pkg.scripts;
    return pkg;
  },
};
