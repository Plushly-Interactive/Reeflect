// Ordered oldest -> newest. Add an entry here when shipping a version worth
// telling users about. Bullet text lives inline (en/es/fr) rather than in
// _locales/*/messages.json, since per-release changelog prose would otherwise
// accumulate there forever. A bullet may use **bold** for a lead-in label,
// e.g. "**Full keyboard navigation**: operate tables without a mouse."
// Category labels (New features / Bug fixes / Improvements) are stable UI
// chrome and still come from messages.json via CHANGELOG_CATEGORIES.
export const CHANGELOG_CATEGORIES = {
  newFeatures: 'changelog_categoryNewFeatures',
  bugFixes: 'changelog_categoryBugFixes',
  improvements: 'changelog_categoryImprovements',
};

export const CHANGELOG_ENTRIES = [
  {
    version: '1.1.0',
    sections: [
      {
        category: 'newFeatures',
        items: [
          {
            en: '**Full keyboard navigation**: operate tables, charts, menus, dialogs, and the date picker entirely without a mouse. Press Alt+Shift+C to open the popup from anywhere.',
            es: '**Navegación completa por teclado**: usa tablas, gráficos, menús, cuadros de diálogo y el selector de fecha sin necesidad del ratón. Pulsa Alt+Shift+C para abrir el popup desde cualquier lugar.',
            fr: '**Navigation complète au clavier** : utilisez les tableaux, graphiques, menus, boîtes de dialogue et le sélecteur de date entièrement sans souris. Appuyez sur Alt+Maj+C pour ouvrir le popup depuis n’importe où.',
          },
          {
            en: '**Screen reader support**: buttons, rule lists, forms, and notifications now announce themselves properly.',
            es: '**Compatibilidad con lectores de pantalla**: los botones, las listas de reglas, los formularios y las notificaciones ahora se anuncian correctamente.',
            fr: '**Prise en charge des lecteurs d’écran** : les boutons, listes de règles, formulaires et notifications s’annoncent désormais correctement.',
          },
          {
            en: '**Better color contrast**: text and controls in both themes now meet WCAG AA contrast guidelines.',
            es: '**Mejor contraste de color**: el texto y los controles en ambos temas ahora cumplen las pautas de contraste WCAG AA.',
            fr: '**Meilleur contraste des couleurs** : le texte et les contrôles des deux thèmes respectent désormais les directives de contraste WCAG AA.',
          },
          {
            en: '**Color-blind friendly charts**: apply a color-blind safe chart palette with one click in settings.',
            es: '**Gráficos aptos para daltónicos**: aplica una paleta de colores apta para daltónicos con un clic en la configuración.',
            fr: '**Graphiques adaptés au daltonisme** : appliquez une palette de couleurs adaptée au daltonisme en un clic dans les paramètres.',
          },
          {
            en: '**Custom chart colors**: pick your own color for each chart series with a new color picker in settings, complete with live preview and reset. Your colors apply across all chart pages and are included in backup export and import.',
            es: '**Colores de gráficos personalizados**: elige tu propio color para cada serie del gráfico con un nuevo selector de color en la configuración, con vista previa en vivo y opción de restablecer. Tus colores se aplican en todas las páginas de gráficos y se incluyen en la exportación e importación de copias de seguridad.',
            fr: '**Couleurs de graphiques personnalisées** : choisissez votre propre couleur pour chaque série de graphique avec un nouveau sélecteur de couleur dans les paramètres, avec aperçu en direct et réinitialisation. Vos couleurs s’appliquent sur toutes les pages de graphiques et sont incluses dans l’export et l’import de sauvegarde.',
          },
        ],
      },
      {
        category: 'bugFixes',
        items: [
          {
            en: 'Some links could not be reached with the keyboard.',
            es: 'Algunos enlaces no se podían alcanzar con el teclado.',
            fr: 'Certains liens n’étaient pas accessibles au clavier.',
          },
          {
            en: 'Clicking a chart bar no longer leaves a keyboard focus ring behind.',
            es: 'Al hacer clic en una barra del gráfico ya no queda un anillo de foco de teclado.',
            fr: 'Cliquer sur une barre de graphique ne laisse plus d’anneau de focus clavier.',
          },
          {
            en: 'Clicking the add-rule button while the form is open now closes it.',
            es: 'Al hacer clic en el botón de añadir regla mientras el formulario está abierto, ahora este se cierra.',
            fr: 'Cliquer sur le bouton d’ajout de règle pendant que le formulaire est ouvert le referme désormais.',
          },
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    sections: [
      {
        category: 'newFeatures',
        items: [
          {
            en: '**What\'s new popup**: after an update, the dashboard shows a dismissable banner listing what changed in the new version.',
            es: '**Ventana de novedades**: tras una actualización, el panel muestra un aviso descartable con los cambios de la nueva versión.',
            fr: '**Fenêtre des nouveautés** : après une mise à jour, le tableau de bord affiche une bannière fermable listant les changements de la nouvelle version.',
          },
          {
            en: '**Version in settings**: the settings page now shows the installed version, with a link to its release notes.',
            es: '**Versión en la configuración**: la página de configuración ahora muestra la versión instalada, con un enlace a sus notas de la versión.',
            fr: '**Version dans les paramètres** : la page des paramètres affiche désormais la version installée, avec un lien vers ses notes de version.',
          },
        ],
      },
      {
        category: 'bugFixes',
        items: [
          {
            en: 'The blocked page showed 0 for time spent and visits instead of the real numbers.',
            es: 'La página de bloqueo mostraba 0 en tiempo empleado y visitas en lugar de los valores reales.',
            fr: 'La page de blocage affichait 0 pour le temps passé et les visites au lieu des valeurs réelles.',
          },
          {
            en: 'The quote on the blocked page changed on every reload instead of staying the same.',
            es: 'La cita de la página de bloqueo cambiaba en cada recarga en lugar de mantenerse igual.',
            fr: 'La citation de la page de blocage changeait à chaque rechargement au lieu de rester la même.',
          },
        ],
      },
    ],
  },
  {
    version: '1.2.1',
    sections: [
      {
        category: 'bugFixes',
        items: [
          {
            en: 'The extension popup did not open in recent Vivaldi versions.',
            es: 'El popup de la extensión no se abría en las versiones recientes de Vivaldi.',
            fr: 'Le popup de l’extension ne s’ouvrait pas dans les versions récentes de Vivaldi.',
          },
        ],
      },
    ],
  },
  {
    version: '1.2.2',
    sections: [
      {
        category: 'bugFixes',
        items: [
          {
            en: 'A blank strip appeared under the dashboard header even when there was nothing new to announce.',
            es: 'Aparecía una franja vacía debajo del encabezado del panel aunque no hubiera novedades que anunciar.',
            fr: 'Une bande vide apparaissait sous l’en-tête du tableau de bord même lorsqu’il n’y avait rien de nouveau à annoncer.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    sections: [
      {
        category: 'improvements',
        items: [
          {
            en: 'CoralClock is now called Reeflect. Nothing else changes: your data, rules and settings stay exactly as they were.',
            es: 'CoralClock ahora se llama Reeflect. Nada más cambia: tus datos, reglas y ajustes se mantienen exactamente igual.',
            fr: 'CoralClock s’appelle désormais Reeflect. Rien d’autre ne change : vos données, règles et réglages restent exactement les mêmes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.4.0',
    sections: [
      {
        category: 'newFeatures',
        items: [
          {
            en: 'Sync across devices: see the same browsing data everywhere and apply limits to your total time. No email or name is ever asked for, and your data is encrypted on your device before it is sent. Settings > Sync across devices.',
            es: 'Sincronización entre dispositivos: consulta los mismos datos de navegación en todas partes y aplica los límites a tu tiempo total. Nunca se pide correo ni nombre, y tus datos se cifran en tu dispositivo antes de enviarse. Ajustes > Sincronización entre dispositivos.',
            fr: 'Synchronisation entre appareils : consultez les mêmes données de navigation partout et appliquez les limites à votre temps total. Aucun e-mail ni nom n’est demandé, et vos données sont chiffrées sur votre appareil avant l’envoi. Réglages > Synchronisation entre appareils.',
          },
        ],
      },
    ],
  },
];
