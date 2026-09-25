/** Local source conditions must never point consumers at files omitted from the tarball. */
export const hooks = {
  beforePacking(pkg) {
    if (!pkg.name?.startsWith('@kushagradhawan/kookie-flow')) return pkg;
    for (const value of Object.values(pkg.exports ?? {})) {
      if (value && typeof value === 'object') delete value['kookie-flow-source'];
    }
    delete pkg.devDependencies;
    delete pkg.scripts;
    return pkg;
  },
};
