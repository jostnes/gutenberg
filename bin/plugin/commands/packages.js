/**
 * External dependencies
 */
const { command } = require( 'execa' );
const path = require( 'path' );
const glob = require( 'fast-glob' );
const fs = require( 'fs' );
const { inc: semverInc } = require( 'semver' );
const readline = require( 'readline' );

/**
 * Internal dependencies
 */
const { log, formats } = require( '../lib/logger' );
const { askForConfirmation, runStep, readJSONFile } = require( '../lib/utils' );
const {
	calculateVersionBumpFromChangelog,
	findReleaseBranchName,
	runGitRepositoryCloneStep,
	runCleanLocalFoldersStep,
} = require( './common' );
const git = require( '../lib/git' );

/**
 * Release type names.
 *
 * @typedef {('latest'|'bugfix'|'patch'|'next')} ReleaseType
 */

/**
 * Semantic Versioning labels.
 *
 * @typedef {('major'|'minor'|'patch')} SemVer
 */

/**
 * @typedef WPPackagesCommandOptions
 *
 * @property {SemVer}  [semver] The selected semantic versioning. Defaults to `patch`.
 * @property {boolean} [ci]     Disables interactive mode when executed in CI mode.
 */

/**
 * @typedef WPPackagesConfig
 *
 * @param    {string}      [gitWorkingDirectoryPath] Git working directory path.
 * @property {boolean}     interactive               Whether to run in interactive mode.
 * @property {SemVer}      minimumVersionBump        The selected minimum version bump.
 * @property {ReleaseType} releaseType               The selected release type.
 */

/**
 * Checks out the WordPress release branch and syncs it with the changes from
 * the last plugin release.
 *
 * @param {WPPackagesConfig} config       Release type selected from CLI.
 * @param {string}           abortMessage Abort Message.
 *
 * @return {Promise<Object>} WordPress release branch.
 */
async function runWordPressReleaseBranchSyncStep(
	{ interactive, gitWorkingDirectoryPath, releaseType },
	abortMessage
) {
	const wordpressReleaseBranch =
		releaseType === 'next' ? 'wp/next' : 'wp/trunk';
	await runStep(
		'Getting into the WordPress release branch',
		abortMessage,
		async () => {
			await git.checkoutRemoteBranch( gitWorkingDirectoryPath, 'trunk' );

			const packageJsonPath = gitWorkingDirectoryPath + '/package.json';
			const pluginReleaseBranch = findReleaseBranchName(
				packageJsonPath
			);

			// Creating the release branch
			await git.checkoutRemoteBranch(
				gitWorkingDirectoryPath,
				wordpressReleaseBranch
			);
			await git.fetch( gitWorkingDirectoryPath, [ '--depth=100' ] );
			log(
				'>> The local release branch ' +
					formats.success( wordpressReleaseBranch ) +
					' has been successfully checked out.'
			);

			if ( [ 'latest', 'next' ].includes( releaseType ) ) {
				if ( interactive ) {
					await askForConfirmation(
						`The branch is ready for sync with the latest plugin release changes applied to "${ pluginReleaseBranch }". Proceed?`,
						true,
						abortMessage
					);
				}

				await git.replaceContentFromRemoteBranch(
					gitWorkingDirectoryPath,
					pluginReleaseBranch
				);

				await git.commit(
					gitWorkingDirectoryPath,
					`Merge changes published in the Gutenberg plugin "${ pluginReleaseBranch }" branch`
				);

				log(
					'>> The local WordPress release branch ' +
						formats.success( wordpressReleaseBranch ) +
						' has been successfully synced.'
				);
			}
		}
	);

	return {
		releaseBranch: wordpressReleaseBranch,
	};
}

/**
 * Update CHANGELOG files with the new version number for those packages that
 * contain new entries.
 *
 * @param {WPPackagesConfig} config       Command config.
 * @param {string}           abortMessage Abort Message.
 *
 * @return {?string}   The optional commit's hash when changelog files updated.
 */
async function updatePackages(
	{ gitWorkingDirectoryPath, interactive, minimumVersionBump, releaseType },
	abortMessage
) {
	const changelogFiles = await glob(
		path.resolve( gitWorkingDirectoryPath, 'packages/*/CHANGELOG.md' )
	);
	const changelogFilesPublicPackages = changelogFiles.filter(
		( changelogPath ) => {
			const pkg = require( path.join(
				path.dirname( changelogPath ),
				'package.json'
			) );
			return pkg.private !== true;
		}
	);

	const productionPackageNames = Object.keys(
		require( '../../../package.json' ).dependencies
	);

	const processedPackages = await Promise.all(
		changelogFilesPublicPackages.map( async ( changelogPath ) => {
			const fileStream = fs.createReadStream( changelogPath );

			const rl = readline.createInterface( {
				input: fileStream,
			} );
			const lines = [];
			for await ( const line of rl ) {
				lines.push( line );
			}

			let versionBump = calculateVersionBumpFromChangelog(
				lines,
				minimumVersionBump
			);
			const packageName = `@wordpress/${
				changelogPath.split( '/' ).reverse()[ 1 ]
			}`;
			// Enforce version bump for production packages when
			// the stable minor or major version bump requested.
			if (
				! versionBump &&
				releaseType !== 'next' &&
				minimumVersionBump !== 'patch' &&
				productionPackageNames.includes( packageName )
			) {
				versionBump = minimumVersionBump;
			}
			const packageJSONPath = changelogPath.replace(
				'CHANGELOG.md',
				'package.json'
			);
			const { version } = readJSONFile( packageJSONPath );
			const nextVersion =
				versionBump !== null ? semverInc( version, versionBump ) : null;

			return {
				changelogPath,
				packageJSONPath,
				packageName,
				nextVersion,
				version,
			};
		} )
	);

	const packagesToUpdate = processedPackages.filter(
		( { nextVersion } ) => nextVersion
	);

	if ( packagesToUpdate.length === 0 ) {
		log( '>> No changes in CHANGELOG files detected.' );
		return;
	}

	log(
		'>> Recommended version bumps based on the changes detected in CHANGELOG files:'
	);

	const publishDate = new Date().toISOString().split( 'T' )[ 0 ];
	await Promise.all(
		packagesToUpdate.map(
			async ( {
				changelogPath,
				packageJSONPath,
				packageName,
				nextVersion,
				version,
			} ) => {
				// Update changelog
				const content = await fs.promises.readFile(
					changelogPath,
					'utf8'
				);
				await fs.promises.writeFile(
					changelogPath,
					content.replace(
						'## Unreleased',
						`## Unreleased\n\n## ${
							releaseType === 'next'
								? nextVersion + '-next.0'
								: nextVersion
						} (${ publishDate })`
					)
				);

				// Update package.json
				const packageJson = readJSONFile( packageJSONPath );
				const newPackageJson = {
					...packageJson,
					version: nextVersion + '-prerelease',
				};
				fs.writeFileSync(
					packageJSONPath,
					JSON.stringify( newPackageJson, null, '\t' ) + '\n'
				);

				log(
					`   - ${ packageName }: ${ version } -> ${
						releaseType === 'next'
							? nextVersion + '-next.0'
							: nextVersion
					}`
				);
			}
		)
	);

	if ( interactive ) {
		await askForConfirmation(
			`All corresponding files were updated. Commit the changes?`,
			true,
			abortMessage
		);
	}

	const commitHash = await git.commit(
		gitWorkingDirectoryPath,
		'Update changelog files',
		[ './*' ]
	);
	log( '>> Changelog files changes have been committed successfully.' );

	return commitHash;
}

/**
 * Push the local Git Changes the remote repository.
 *
 * @param {WPPackagesConfig} config       Command config.
 * @param {string}           abortMessage Abort message.
 */
async function runPushGitChangesStep(
	{ gitWorkingDirectoryPath, interactive, releaseBranch },
	abortMessage
) {
	await runStep( 'Pushing the release branch', abortMessage, async () => {
		if ( interactive ) {
			await askForConfirmation(
				'The release branch is going to be pushed to the remote repository. Continue?',
				true,
				abortMessage
			);
		}
		await git.pushBranchToOrigin( gitWorkingDirectoryPath, releaseBranch );
	} );
}

/**
 * Publishes all changed packages to npm.
 *
 * @param {WPPackagesConfig} config Command config.
 *
 * @return {?string} The optional commit's hash when changelog files updated.
 */
async function publishPackagesToNpm( {
	gitWorkingDirectoryPath,
	minimumVersionBump,
	releaseType,
} ) {
	log( '>> Installing npm packages.' );
	await command( 'npm ci', {
		cwd: gitWorkingDirectoryPath,
	} );

	if ( releaseType === 'next' ) {
		log(
			'>> Bumping version of public packages changed since the last release.'
		);
		const commitHash = await git.getLastCommitHash(
			gitWorkingDirectoryPath
		);
		await command(
			`npx lerna version pre${ minimumVersionBump } --preid next.${ commitHash } --no-private`,
			{
				cwd: gitWorkingDirectoryPath,
				stdio: 'inherit',
			}
		);

		log( '>> Publishing modified packages to npm.' );
		await command( 'npx lerna publish from-package --dist-tag next', {
			cwd: gitWorkingDirectoryPath,
			stdio: 'inherit',
		} );
	} else if ( releaseType === 'bugfix' ) {
		log( '>> Publishing modified packages to npm.' );
		await command( `npm run publish:latest`, {
			cwd: gitWorkingDirectoryPath,
			stdio: 'inherit',
		} );
	} else {
		log(
			'>> Bumping version of public packages changed since the last release.'
		);
		await command(
			`npx lerna version ${ minimumVersionBump } --no-private`,
			{
				cwd: gitWorkingDirectoryPath,
				stdio: 'inherit',
			}
		);

		log( '>> Publishing modified packages to npm.' );
		await command( `npx lerna publish from-package`, {
			cwd: gitWorkingDirectoryPath,
			stdio: 'inherit',
		} );
	}

	return await git.getLastCommitHash( gitWorkingDirectoryPath );
}

/**
 * Backports commits from the release branch to the `trunk` branch.
 *
 * @param {WPPackagesConfig} config  Command config.
 * @param {string[]}         commits The list of commits to backport.
 */
async function backportCommitsToTrunk(
	{ gitWorkingDirectoryPath, releaseType },
	commits
) {
	if (
		! [ 'latest', 'bugfix' ].includes( releaseType ) ||
		commits.length === 0
	) {
		return;
	}

	log( '>> Backporting commits.' );
	await git.resetLocalBranchAgainstOrigin( gitWorkingDirectoryPath, 'trunk' );
	for ( const commitHash of commits ) {
		await git.cherrypickCommitIntoBranch(
			gitWorkingDirectoryPath,
			commitHash
		);
	}
	await git.pushBranchToOrigin( gitWorkingDirectoryPath, 'trunk' );
}

/**
 * Prepare everything to publish WordPress packages to npm.
 *
 * @param {WPPackagesConfig} config         Command config.
 * @param {string[]}         customMessages Custom messages to print in the terminal.
 *
 * @return {Promise<Object>} GitHub release object.
 */
async function prepareForPackageRelease( config, customMessages ) {
	log(
		formats.title(
			'\n💃 Time to publish WordPress packages to npm 🕺\n\n'
		),
		"To perform a release you'll have to be a member of the WordPress Team on npm.\n",
		...customMessages
	);

	const abortMessage = 'Aborting!';
	const temporaryFolders = [];
	if ( config.interactive ) {
		await askForConfirmation( 'Ready to go?' );

		// Cloning the Git repository.
		config.gitWorkingDirectoryPath = await runGitRepositoryCloneStep(
			abortMessage
		);
		temporaryFolders.push( config.gitWorkingDirectoryPath );
	} else {
		config.gitWorkingDirectoryPath = process.cwd();
	}

	// Checking out the WordPress release branch and doing sync with the last plugin release.
	const { releaseBranch } = await runWordPressReleaseBranchSyncStep(
		config,
		abortMessage
	);

	const commitHashChangelogUpdates = await updatePackages(
		config,
		abortMessage
	);

	await runPushGitChangesStep(
		config,
		`Aborting! Make sure to push changes applied to WordPress release branch "${ releaseBranch }" manually.`
	);

	const commitHashNpmPublish = await publishPackagesToNpm( config );

	await backportCommitsToTrunk(
		config,
		[ commitHashChangelogUpdates, commitHashNpmPublish ].filter( Boolean )
	);

	await runCleanLocalFoldersStep( temporaryFolders, 'Cleaning failed.' );

	log(
		'\n>> 🎉 WordPress packages are now published!\n\n',
		'Let also people know on WordPress Slack and celebrate together.'
	);
}

/**
 * Publishes a new latest version of WordPress packages.
 *
 * @param {WPPackagesCommandOptions} options Command options.
 */
async function publishNpmLatestDistTag( { ci, semver } ) {
	await prepareForPackageRelease(
		{
			interactive: ! ci,
			minimumVersionBump: semver,
			releaseType: 'latest',
		},
		[
			'Welcome! This tool helps with publishing a new latest version of WordPress packages.\n',
		]
	);
}

/**
 * Publishes a new latest version of WordPress packages.
 *
 * @param {WPPackagesCommandOptions} options Command options.
 */
async function publishNpmBugfixLatestDistTag( { ci, semver } ) {
	await prepareForPackageRelease(
		{
			interactive: ! ci,
			minimumVersionBump: semver,
			releaseType: 'bugfix',
		},
		[
			'Welcome! This tool is going to help you with publishing a new bugfix version of WordPress packages with the latest dist tag.\n',
			'Make sure that all required changes have been already cherry-picked to the release branch.\n',
		]
	);
}

/**
 * Publishes a new next version of WordPress packages.
 *
 * @param {WPPackagesCommandOptions} options Command options.
 */
async function publishNpmNextDistTag( { ci, semver } ) {
	await prepareForPackageRelease(
		{
			interactive: ! ci,
			minimumVersionBump: semver,
			releaseType: 'next',
		},
		[
			'Welcome! This tool helps with publishing a new next version of WordPress packages.\n',
		]
	);
}

module.exports = {
	publishNpmLatestDistTag,
	publishNpmBugfixLatestDistTag,
	publishNpmNextDistTag,
};
