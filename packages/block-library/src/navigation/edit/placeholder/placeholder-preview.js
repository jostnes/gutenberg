/**
 * External dependencies
 */
import classnames from 'classnames';

/**
 * WordPress dependencies
 */
import { Icon, navigation } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
import { Spinner } from '@wordpress/components';
import { useEffect } from '@wordpress/element';
import { speak } from '@wordpress/a11y';

const PlaceholderPreview = ( { isLoading } ) => {
	useEffect( () => {
		if ( isLoading ) {
			speak( 'Navigation block is loading.', 'assertive' );
		}

		return () => {
			if ( isLoading ) {
				speak( 'Navigation block loaded.', 'assertive' );
			}
		};
	}, [ isLoading ] );

	return (
		<div
			className={ classnames(
				'wp-block-navigation-placeholder__preview',
				{ 'is-loading': isLoading }
			) }
		>
			<div className="wp-block-navigation-placeholder__actions__indicator">
				<Icon icon={ navigation } />
				{ __( 'Navigation' ) }
				{ isLoading && <Spinner /> }
			</div>
		</div>
	);
};

export default PlaceholderPreview;
