export function JsonLd() {
  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Kookie Flow',
    description:
      "WebGL-native node graph library. React Flow's ergonomics, GPU-rendered for performance at scale.",
    url: 'https://kookie-flow.vercel.app',
    codeRepository: 'https://github.com/KushagraDhawan1997/kookie-flow',
    programmingLanguage: ['TypeScript', 'JavaScript', 'GLSL'],
    runtimePlatform: 'Web Browser',
    license: 'https://opensource.org/licenses/MIT',
    author: {
      '@type': 'Person',
      name: 'Kushagra Dhawan',
      url: 'https://github.com/KushagraDhawan1997',
    },
    keywords: [
      'node graph',
      'webgl',
      'react',
      'three.js',
      'react-three-fiber',
      'node editor',
      'workflow',
      'diagram',
    ],
  };

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Kookie',
    url: 'https://github.com/KushagraDhawan1997',
    logo: 'https://kookie-flow.vercel.app/logo.png',
    sameAs: [
      'https://github.com/KushagraDhawan1997',
      'https://twitter.com/kushagradh',
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
    </>
  );
}
