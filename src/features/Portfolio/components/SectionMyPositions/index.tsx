import { useRef } from 'react'
import { Box, Flex, Grid, GridItem, HStack, Heading, SimpleGrid, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/router'
import { Rounding } from '@raydium-io/raydium-sdk-v2'
import Button from '@/components/Button'
import Tabs from '@/components/Tabs'
import { colors } from '@/theme/cssVariables'
import { useAppStore } from '@/store/useAppStore'

import { ClmmMyPositionTabContent } from './TabClmm'
import MyPositionTabStaked from './TabStaked'
import MyPositionTabStandard from './TabStandard'
import { Desktop, Mobile } from '@/components/MobileDesktop'
import { Select } from '@/components/Select'
import { useStateWithUrl } from '@/hooks/useStateWithUrl'

import useAllPositionInfo from '@/hooks/portfolio/useAllPositionInfo'
import { panelCard } from '@/theme/cssBlocks'
import toUsdVolume from '@/utils/numberish/toUsdVolume'
import { QuestionToolTip } from '@/components/QuestionToolTip'
import { useEvent } from '@/hooks/useEvent'

export type PositionTabValues = 'concentrated' | 'standard' | 'staked RAY'

export default function SectionMyPositions() {
  const { t } = useTranslation()
  const { query } = useRouter()
  const tabs: {
    value: PositionTabValues
    label: string
  }[] = [
    {
      value: 'concentrated',
      label: t('portfolio.section_positions_tab_clmm')
    },
    {
      value: 'standard',
      label: t('portfolio.section_positions_tab_standard')
    },
    {
      value: 'staked RAY',
      label: t('portfolio.section_positions_tab_staking')
    }
  ]
  const connected = useAppStore((s) => s.connected)

  const defaultTab = (query.tab as string) || tabs[0].value

  const [currentTab, setCurrentTab] = useStateWithUrl(defaultTab, 'position_tab', {
    fromUrl: (v) => v,
    toUrl: (v) => v
  })

  const onTabChange = (tab: any) => {
    setCurrentTab(tab)
  }

  const isFocusClmmTab = currentTab === tabs[0].value
  const isFocusStandardTab = currentTab === tabs[1].value
  const isFocusStake = currentTab === tabs[2].value

  const noRewardClmmPos = useRef<Set<string>>(new Set())

  const setNoRewardClmmPos = useEvent((poolId: string, isDelete?: boolean) => {
    if (isDelete) {
      noRewardClmmPos.current.delete(poolId)
      return
    }
    noRewardClmmPos.current.add(poolId)
  })

  const {
    handleHarvest,
    farmLpBasedData,
    stakedFarmMap,
    allFarmBalances,
    clmmBalanceInfo,
    isClmmLoading,
    isFarmLoading,
    totalPendingYield,
    isReady,
    isSending
  } = useAllPositionInfo({})

  return (
    <>
      <Grid
        gridTemplate={[
          `
          "title  tabs  " auto
          "action action" auto / 1fr 1fr
        `,
          `
          "title " auto
          "tabs  " auto
          "action" auto / 1fr 
        `,
          `
          "title title " auto
          "tabs  action" auto / 1fr 1fr
        `
        ]}
        columnGap={3}
        rowGap={[3, 2]}
        mb={3}
        mt={6}
        alignItems={'center'}
      >
        <GridItem area={'title'}>
          <Heading id="my-position" fontSize={['lg', 'xl']} fontWeight="500" color={colors.textPrimary}>
            {t('portfolio.section_positions')}
          </Heading>
        </GridItem>
        <GridItem area="tabs" justifySelf={['right', 'left']}>
          <Desktop>
            <Tabs size="md" variant="rounded" items={tabs} onChange={onTabChange} value={currentTab} />
          </Desktop>
          <Mobile>
            <Select variant="roundedFilledFlowDark" items={tabs} onChange={onTabChange} value={currentTab} />
          </Mobile>
        </GridItem>
        <GridItem area={'action'} justifySelf={['stretch', 'stretch', 'right']}>
          {connected ? (
            <Box py="6px" px={4} bg={colors.transparentContainerBg} borderRadius="12px">
              <HStack justify={'space-between'} gap={8}>
                <Flex gap={[0, 2]} direction={['column', 'row']} fontSize={['xs', 'sm']} align={['start', 'center']}>
                  <Text whiteSpace={'nowrap'} color={colors.textSecondary}>
                    {t('portfolio.harvest_all_label')}
                  </Text>
                  <HStack>
                    <Text whiteSpace={'nowrap'} color={colors.textPrimary} fontWeight={500}>
                      {toUsdVolume(totalPendingYield.toString(), { decimals: 4, rounding: Rounding.ROUND_DOWN, decimalMode: 'trim' })}
                    </Text>
                    {/* TODO not need now */}
                    {/* <QuestionToolTip
                      label={t('portfolio.harvest_all_tooltip')}
                      iconType="info"
                      iconProps={{ color: colors.textSecondary }}
                    /> */}
                  </HStack>
                </Flex>
                <Button
                  size={['sm', 'md']}
                  isLoading={isSending}
                  isDisabled={!isReady}
                  onClick={() => handleHarvest(noRewardClmmPos.current)}
                >
                  {t('portfolio.harvest_all_button')}
                </Button>
              </HStack>
            </Box>
          ) : null}
        </GridItem>
      </Grid>
      {connected ? (
        isFocusClmmTab ? (
          <ClmmMyPositionTabContent isLoading={isClmmLoading} clmmBalanceInfo={clmmBalanceInfo} setNoRewardClmmPos={setNoRewardClmmPos} />
        ) : isFocusStandardTab ? (
          <MyPositionTabStandard
            isLoading={isFarmLoading}
            allFarmBalances={allFarmBalances}
            lpBasedData={farmLpBasedData}
            stakedFarmMap={stakedFarmMap}
          />
        ) : isFocusStake ? (
          <MyPositionTabStaked allFarmBalances={allFarmBalances} />
        ) : null
      ) : (
        <SimpleGrid {...panelCard} placeItems={'center'} bg={colors.backgroundLight} borderRadius="12px" py={12}>
          <Text my={8} color={colors.textTertiary} fontSize={['sm', 'md']}>
            {t('wallet.connected_hint.portfolio_position')}
          </Text>
        </SimpleGrid>
      )}
    </>
  )
}
