# Tests AntelopeJS

## Structure

```
tests/
├── e2e/                 # Tests end-to-end du CLI (spawn le vrai binaire)
├── integration/         # Tests d'intégration (modules qui interagissent)
├── unit/               # Tests unitaires (fonctions isolées avec mocks)
├── helpers/            # Utilitaires partagés
│   ├── setup.ts        # Configuration Chai/Sinon
│   ├── integration.ts  # Helpers pour tests d'intégration
│   └── mocks/          # Mocks réutilisables
└── fixtures/           # Données de test
```

## Conventions

### Tests unitaires

- Un fichier de test par fichier source : `src/foo/bar.ts` -> `tests/unit/foo/bar.test.ts`
- Utiliser `proxyquire` pour mocker les dépendances
- **NE PAS** tester des interfaces TypeScript (pas de `expect(obj.prop).to.equal(valeurDefinie)`)
- Tester le comportement, pas la structure

### Exemple de BON test

```typescript
it('should return error when file not found', async () => {
  mockFs.readFile.rejects(new Error('ENOENT'));

  const result = await loadConfig('/nonexistent');

  expect(result).to.be.undefined;
  expect(mockLogger.error).to.have.been.called;
});
```

### Exemple de MAUVAIS test (a eviter)

```typescript
// NE PAS FAIRE - Ceci ne teste rien !
it('should have name property', () => {
  const obj = { name: 'test' };
  expect(obj.name).to.equal('test');
});
```

### Tests E2E

- Spawn le vrai CLI : `runCLI(['command', 'arg'])`
- Verifier exit code, stdout, stderr
- Verifier les fichiers crees/modifies
- Timeout genereux (30-60s)

### Tests d'integration

- Tester l'interaction entre plusieurs modules
- Peuvent acceder au filesystem et au reseau
- Utiliser les helpers `createTempDir`, `cleanupDir`

## Commandes

```bash
# Tous les tests
npm test

# Tests unitaires uniquement
npm run test:unit

# Tests d'integration uniquement
npm run test:integration

# Avec coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Coverage

Objectif : **80%** minimum

Le build CI echouera si la coverage est inferieure a 80% (une fois le seuil active).

Note: Le seuil est actuellement desactive (`check-coverage: false` dans `.nycrc.json`)
car la coverage actuelle est de ~67.7%. Il sera active une fois l'objectif de 80% atteint.
