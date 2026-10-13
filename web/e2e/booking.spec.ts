import { expect, test } from '@playwright/test';

test.describe('E2E Booking Flow: Browse -> Hold -> Checkout', () => {
  test('customer can browse events, select a showing, hold a seat, and complete checkout', async ({ page }) => {
    // 1. Mock authentication: User is a signed-in customer with seatwise.token
    await page.addInitScript(() => {
      localStorage.setItem('seatwise.token', 'test-jwt-token');
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 1, email: 'priya@example.com', name: 'Priya Sharma', role: 'customer' },
        }),
      });
    });

    // 2. Mock Browse listings & cities
    await page.route('**/api/cities', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cities: ['Bengaluru', 'Mumbai'] }),
      });
    });

    await page.route('**/api/events?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              id: 1,
              title: 'Interstellar (10th Anniversary IMAX)',
              kind: 'movie',
              description: 'Mankind was born on Earth. It was never meant to die here.',
              language: 'English',
              runtimeMin: 169,
              organiser: 'PVR IMAX',
              showCount: 1,
              nextShowAt: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        }),
      });
    });

    // 3. Mock EventDetail
    await page.route('**/api/events/1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: 1,
            title: 'Interstellar (10th Anniversary IMAX)',
            kind: 'movie',
            description: 'Mankind was born on Earth. It was never meant to die here.',
            language: 'English',
            runtimeMin: 169,
            organiser: 'PVR IMAX',
            shows: [
              {
                id: 101,
                startsAt: new Date(Date.now() + 86400000).toISOString(),
                venueName: 'IMAX Orion',
                venueCity: 'Bengaluru',
                seats: 20,
                available: 19,
                fromPrice: 15,
              },
            ],
          },
        }),
      });
    });

    // 4. Mock Show details, seat stream, and seat map
    await page.route('**/api/shows/101/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: ': ping\n\n',
      });
    });

    let isHeld = false;
    await page.route('**/api/shows/101', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: {
            id: 101,
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            venueName: 'IMAX Orion',
            venueCity: 'Bengaluru',
            event: { id: 1, title: 'Interstellar (10th Anniversary IMAX)', kind: 'movie' },
          },
        }),
      });
    });

    await page.route('**/api/shows/101/seats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categories: [{ categoryId: 1, category: 'Prime', price: 15, available: isHeld ? 0 : 1, total: 1 }],
          hold: isHeld
            ? {
                id: 'hold-123',
                showId: 101,
                seatIds: [1],
                total: 15,
                holdExpiresAt: Date.now() + 120_000,
              }
            : null,
          seats: [
            {
              id: 1,
              rowLabel: 'A',
              seatNumber: 1,
              label: 'A1',
              categoryId: 1,
              category: 'Prime',
              price: 15,
              status: isHeld ? 'held' : 'available',
              heldByMe: isHeld,
              holdExpiresAt: isHeld ? Date.now() + 120_000 : null,
              holdKind: isHeld ? 'cart' : null,
            },
          ],
        }),
      });
    });

    await page.route('**/api/waitlist', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [] }),
      });
    });

    // 5. Mock Hold action
    await page.route('**/api/shows/101/hold', async (route) => {
      if (route.request().method() === 'POST') {
        isHeld = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hold: {
              id: 'hold-123',
              showId: 101,
              seatIds: [1],
              total: 15,
              holdExpiresAt: Date.now() + 120_000,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 6. Mock Booking creation & detail
    await page.route('**/api/bookings', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            booking: {
              id: 501,
              reference: 'SW-TEST9999',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/bookings/501', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          booking: {
            id: 501,
            reference: 'SW-TEST9999',
            title: 'Interstellar (10th Anniversary IMAX)',
            kind: 'movie',
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            venueName: 'IMAX Orion',
            venueCity: 'Bengaluru',
            amount: 15,
            status: 'confirmed',
            seats: [{ label: 'A1', category: 'Prime' }],
          },
        }),
      });
    });

    await page.route('**/api/bookings/501/qr', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }),
      });
    });

    // ==========================================
    // STEP 1: BROWSE
    // ==========================================
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText("What's on");
    await expect(page.getByText('Interstellar (10th Anniversary IMAX)')).toBeVisible();

    // Click View showings
    await page.getByRole('link', { name: /View showings/i }).click();

    // ==========================================
    // STEP 2: EVENT DETAIL -> PICK SEATS
    // ==========================================
    await expect(page.locator('h1')).toHaveText('Interstellar (10th Anniversary IMAX)');
    await expect(page.getByText('IMAX Orion, Bengaluru')).toBeVisible();

    // Click Pick seats
    await page.getByRole('link', { name: /Pick seats/i }).click();

    // ==========================================
    // STEP 3: SEATING MAP & HOLD SEAT
    // ==========================================
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Interstellar (10th Anniversary IMAX)');
    const seatA1 = page.getByRole('button', { name: /Seat A1/i });
    await expect(seatA1).toBeVisible();
    await expect(seatA1).toBeEnabled();

    // Click to select seat A1
    await seatA1.click();
    await expect(seatA1).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Seat A1')).toBeVisible();

    // Click Hold 1 seat
    const holdBtn = page.getByRole('button', { name: /Hold 1 seat/i });
    await expect(holdBtn).toBeEnabled();
    await holdBtn.click();

    // Assert prominent countdown timer appears
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.getByText(/Seats Held/i)).toBeVisible();

    // ==========================================
    // STEP 4: GUEST DETAILS & CHECKOUT
    // ==========================================
    const mobileInput = page.getByLabel(/Mobile number/i);
    await mobileInput.fill('+91 98765 43210');

    // Confirm booking
    const confirmBtn = page.getByRole('button', { name: /Confirm booking/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // ==========================================
    // STEP 5: BOOKING CONFIRMATION TICKET
    // ==========================================
    await expect(page).toHaveURL(/\/bookings\/501/);
    await expect(page.getByText('SW-TEST9999')).toBeVisible();
    await expect(page.getByText('Booking confirmed. A copy has been emailed to you.')).toBeVisible();
    await expect(page.locator('.toast-message').last()).toHaveText('Booking confirmed!');
  });
});
