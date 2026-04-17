# Branch Protection Requirements

## Protected Branches
- `main`
- `develop`

## Protection Rules
1. **Require status checks to pass before merging**
   - `ci/lint-build` (GitHub Actions CI pipeline)

2. **Require pull request reviews before merging**
   - At least 1 approved review
   - Dismiss stale approvals when new commits are pushed

3. **Include administrators** - Applies to admins as well

4. **Restrict who can push to matching branches**
   - Only allow pushes via pull requests

## GitHub Actions Status Check
The CI pipeline (`ci/lint-build`) must pass for all PRs targeting `main` or `develop`.

## Configuration Instructions
1. Go to repository **Settings** → **Branches**
2. Click **Add rule** for branch `main`
3. Configure:
   - Branch name pattern: `main`
   - Require status checks to pass: ✅
   - Status checks that are required: `ci/lint-build`
   - Require pull request reviews before merging: ✅ (1 required)
   - Include administrators: ✅
   - Restrict who can push to matching branches: ✅
4. Repeat for `develop` branch

## Verification
- Create a test PR to verify CI runs and blocks merge if failing
- Verify approved review is required before merge