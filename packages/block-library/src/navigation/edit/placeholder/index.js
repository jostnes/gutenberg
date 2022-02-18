/**
 * WordPress dependencies
 */
import {
	Placeholder,
	Button,
	DropdownMenu,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { navigation, Icon } from '@wordpress/icons';

/**
 * Internal dependencies
 */

import useNavigationEntities from '../../use-navigation-entities';
import PlaceholderPreview from './placeholder-preview';
import useNavigationMenu from '../../use-navigation-menu';
import useCreateNavigationMenu from '../use-create-navigation-menu';
import NavigationMenuSelector from '../navigation-menu-selector';

export default function NavigationPlaceholder( {
	clientId,
	onFinish,
	canSwitchNavigationMenu,
	canUserCreateNavigationMenu = false,
	isResolvingCanUserCreateNavigationMenu,
} ) {
	const createNavigationMenu = useCreateNavigationMenu( clientId );

	const onFinishMenuCreation = async (
		blocks,
		navigationMenuTitle = null
	) => {
		if ( ! canUserCreateNavigationMenu ) {
			return;
		}

		const navigationMenu = await createNavigationMenu(
			navigationMenuTitle,
			blocks
		);
		onFinish( navigationMenu, blocks );
	};

	const { hasMenus, isResolvingMenus } = useNavigationEntities();

	const onCreateEmptyMenu = () => {
		onFinishMenuCreation( [] );
	};

	const { navigationMenus } = useNavigationMenu();

	const hasNavigationMenus = !! navigationMenus?.length;

	const showSelectMenus =
		( canSwitchNavigationMenu || canUserCreateNavigationMenu ) &&
		( hasNavigationMenus || hasMenus );

	const isResolvingActions =
		isResolvingMenus || isResolvingCanUserCreateNavigationMenu;

	return (
		<>
			<Placeholder className="wp-block-navigation-placeholder">
				{
					// The <PlaceholderPreview> component is displayed conditionally via CSS depending on
					// whether the block is selected or not. This is achieved via CSS to avoid
					// component re-renders
				 }
				<PlaceholderPreview />
				<div className="wp-block-navigation-placeholder__controls">
					<div className="wp-block-navigation-placeholder__actions">
						<div className="wp-block-navigation-placeholder__actions__indicator">
							<Icon icon={ navigation } /> { __( 'Navigation' ) }
						</div>

						<hr />

						{ isResolvingActions && <Spinner /> }

						{ showSelectMenus ? (
							<>
								<DropdownMenu
									text={ __( 'Select menu' ) }
									icon={ null }
									toggleProps={ {
										variant: 'tertiary',
										iconPosition: 'right',
										className:
											'wp-block-navigation-placeholder__actions__dropdown',
									} }
									popoverProps={ { isAlternate: true } }
								>
									{ () => (
										<NavigationMenuSelector
											clientId={ clientId }
											onSelect={ onFinish }
										/>
									) }
								</DropdownMenu>
								<hr />
							</>
						) : undefined }

						{ canUserCreateNavigationMenu && (
							<Button
								variant="tertiary"
								onClick={ onCreateEmptyMenu }
							>
								{ __( 'Start empty' ) }
							</Button>
						) }
					</div>
				</div>
			</Placeholder>
		</>
	);
}
