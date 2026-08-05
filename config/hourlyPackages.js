const hourlyPackages = [
  {
    id: 1,
    slug: "hourly-booking",
    category: "Hourly Booking",
    name: "Hourly Booking",
    description: "Flexible videography coverage with tiered duration pricing and add-on videos.",
    fullDescription:
      "Hourly Booking is our flexible coverage option for events that need premium videography support without committing to a fixed package. Select a duration tier, choose how many videos you want delivered, and continue through the same booking flow used by every other package.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-2.jpg",
    features: [
      "Select the coverage tier that fits your event",
      "Add extra edited videos as needed",
    ],
    duration: "0-12 Hours",
    delivery: "Custom delivery timeline",
    price: 130000,
    popular: true,
    packageType: "hourly",
    isHourly: true,
    bookingConfig: {
      mode: "hourly-booking",
      durationLabel: "Coverage Tier",
      durationOptions: [
        { label: "0–3 Hours — ₦60,000", value: 3, price: 60000 },
        { label: "3–6 Hours — ₦100,000", value: 6, price: 110000 },
        { label: "6–9 Hours — ₦160,000", value: 9, price: 160000 },
        { label: "9–12 Hours — ₦220,000", value: 12, price: 220000 },
      ],
      videoLabel: "Number of Videos",
      videoPrice: 70000,
      videoOptions: [1, 2, 3, 4, 5],
      eventTypes: [
        "Birthday Parties",
        "Lifestyle Content",
        "Anniversaries",
        "Memorials",
        "BTS Shoots",
        "Naming Ceremony / Baby Dedication",
        "Personal Branding (Talking Head Videos)",
        "Others"
      ],
    },
  },
];

export default hourlyPackages;