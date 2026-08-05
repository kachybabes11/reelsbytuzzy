const corporatePackages = [
  {
    id: 1,
    slug: "corporate-hourly-booking",
    category: "Corporate Events",
    name: "Corporate Hourly Booking",
    description: "Flexible videography coverage with tiered duration pricing and add-on videos.",
    fullDescription:
      "Hourly Booking is our flexible coverage option for corporate events that need premium videography support without committing to a fixed package. Select a duration tier, choose how many videos you want delivered.",
    mediaType: "image",
    mediaSrc: "/assets/beauty-2.jpg",
    features: [
      "Select the coverage tier that fits your corporate event",
      "Add extra edited videos as needed",
    ],
    duration: "0-12 Hours",
    delivery: "Custom delivery timeline",
    price: 170000,
    popular: true,
    packageType: "hourly",
    isHourly: true,
    bookingConfig: {
      mode: "hourly-booking",
      durationLabel: "Coverage Tier",
      durationOptions: [
        { label: "0–3 Hours — ₦100,000", value: 3, price: 100000 },
        { label: "3–6 Hours — ₦170,000", value: 6, price: 170000 },
        { label: "6–9 Hours — ₦250,000", value: 9, price: 250000 },
        { label: "9–12 Hours — ₦350,000", value: 12, price: 350000 },
      ],
      videoLabel: "Number of Videos",
      videoPrice: 70000,
      videoOptions: [1, 2, 3, 4, 5],    
    },
  },
];

export default corporatePackages;