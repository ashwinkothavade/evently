import { Avatar, Badge, Box, Button, Container, Flex, HStack, Icon, IconButton, Link, Menu, Portal, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { LuBell, LuCalendarDays, LuChartColumn, LuLogOut, LuSettings2, LuTicket } from 'react-icons/lu';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useNotifications } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { ColorModeButton } from '../theme/color-mode';

function NavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link asChild variant="plain" _hover={{ textDecoration: 'none' }}>
      <NavLink to={to} end={to === '/'}>
        {({ isActive }) => (
          <HStack
            gap="2"
            px="3"
            py="1.5"
            borderRadius="md"
            fontWeight="medium"
            fontSize="sm"
            color={isActive ? 'brand.fg' : 'fg.muted'}
            bg={isActive ? 'brand.subtle' : 'transparent'}
            _hover={{ bg: isActive ? 'brand.subtle' : 'bg.muted' }}
          >
            <Icon boxSize="4">{icon}</Icon>
            <Text display={{ base: 'none', md: 'block' }}>{children}</Text>
          </HStack>
        )}
      </NavLink>
    </Link>
  );
}

function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useNotifications(true);
  const unread = data?.meta.unreadCount ?? 0;
  return (
    <Box position="relative">
      <IconButton aria-label={`Notifications (${unread} unread)`} variant="ghost" size="sm" onClick={() => navigate('/notifications')}>
        <LuBell />
      </IconButton>
      {unread > 0 && (
        <Badge position="absolute" top="-1" right="-1" colorPalette="red" variant="solid" borderRadius="full" size="xs" pointerEvents="none">
          {unread > 9 ? '9+' : unread}
        </Badge>
      )}
    </Box>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <Flex direction="column" minH="100vh">
      <Box as="header" bg="bg.panel" borderBottomWidth="1px" borderColor="border.muted" position="sticky" top="0" zIndex="sticky">
        <Container maxW="7xl">
          <Flex h="16" align="center" gap="4">
            <Link asChild variant="plain" _hover={{ textDecoration: 'none' }}>
              <NavLink to="/">
                <HStack gap="2">
                  <Flex boxSize="8" borderRadius="lg" bg="brand.solid" color="brand.contrast" align="center" justify="center">
                    <LuTicket />
                  </Flex>
                  <Text fontWeight="800" fontSize="lg" letterSpacing="tight">
                    Evently
                  </Text>
                </HStack>
              </NavLink>
            </Link>

            <HStack as="nav" gap="1" ml="4">
              <NavItem to="/" icon={<LuCalendarDays />}>Events</NavItem>
              {user && <NavItem to="/bookings" icon={<LuTicket />}>My bookings</NavItem>}
              {user?.role === 'admin' && (
                <>
                  <NavItem to="/admin/events" icon={<LuSettings2 />}>Manage events</NavItem>
                  <NavItem to="/admin/analytics" icon={<LuChartColumn />}>Analytics</NavItem>
                </>
              )}
            </HStack>

            <HStack ml="auto" gap="2">
              <ColorModeButton />
              {user ? (
                <>
                  <NotificationBell />
                  <Menu.Root positioning={{ placement: 'bottom-end' }}>
                    <Menu.Trigger asChild>
                      <Button variant="ghost" size="sm" px="1" aria-label="Account menu">
                        <Avatar.Root size="xs" colorPalette="brand">
                          <Avatar.Fallback name={user.name} />
                        </Avatar.Root>
                      </Button>
                    </Menu.Trigger>
                    <Portal>
                      <Menu.Positioner>
                        <Menu.Content minW="56">
                          <Box px="3" py="2">
                            <Text fontWeight="semibold" fontSize="sm">{user.name}</Text>
                            <Text color="fg.muted" fontSize="xs">{user.email}</Text>
                            {user.role === 'admin' && <Badge mt="1" colorPalette="brand" size="sm">Admin</Badge>}
                          </Box>
                          <Menu.Separator />
                          <Menu.Item value="bookings" onClick={() => navigate('/bookings')}><LuTicket /> My bookings</Menu.Item>
                          <Menu.Item value="notifications" onClick={() => navigate('/notifications')}><LuBell /> Notifications</Menu.Item>
                          <Menu.Separator />
                          <Menu.Item value="logout" color="fg.error" onClick={() => { logout(); navigate('/'); }}>
                            <LuLogOut /> Sign out
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                    </Portal>
                  </Menu.Root>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>Sign in</Button>
                  <Button colorPalette="brand" size="sm" onClick={() => navigate('/register')}>Create account</Button>
                </>
              )}
            </HStack>
          </Flex>
        </Container>
      </Box>

      <Container as="main" maxW="7xl" py={{ base: '6', md: '10' }} flex="1">
        <Outlet />
      </Container>

      <Box as="footer" borderTopWidth="1px" borderColor="border.muted" py="6">
        <Container maxW="7xl">
          <Text color="fg.subtle" fontSize="sm">Evently · Book with confidence – you can never be oversold.</Text>
        </Container>
      </Box>
    </Flex>
  );
}
